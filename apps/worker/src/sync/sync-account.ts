import type { CredentialVault } from "@atc/crypto";
import type { Exchange, PrismaClient } from "@atc/db";
import type {
  AdapterRegistry,
  ApiCredentials,
  HistorySource,
  MetaApiClient,
  VerificationFailure,
  VerificationFailureCode,
} from "@atc/exchange-adapters";
import { EXCHANGE_CATALOG, type SyncKind } from "@atc/shared";
import { log } from "../logger.js";
import { connectMetatrader } from "./metatrader.js";
import { openPositionRows } from "./open-positions.js";
import { saveBatch } from "./persist.js";
import { rebuildFromExchange, rebuildFromFills } from "./rebuild.js";

/** Re-download a little before the last sync end: late-arriving records are then picked up. */
const OVERLAP_MS = 10 * 60_000;
/** Re-check that the key is still read-only at least this often. */
const REVERIFY_MS = 24 * 3_600_000;
const CURSOR_STREAM = "history";

/** Failures the user must fix on the exchange: stop syncing and tell them. */
const USER_ACTION_CODES = new Set<VerificationFailureCode>([
  "INVALID_KEY",
  "INVALID_SECRET",
  "INVALID_PASSPHRASE",
  "IP_NOT_ALLOWED",
  "KEY_EXPIRED",
  "MISSING_PERMISSIONS",
  "FUTURES_UNAVAILABLE",
  "ACCOUNT_RESTRICTED",
]);

export interface SyncDeps {
  db: PrismaClient;
  vault: CredentialVault;
  adapters: AdapterRegistry;
  createSource: (exchange: Exchange, credentials: ApiCredentials) => HistorySource;
  now: () => number;
  /** MetaTrader brokers (Exness): logs accounts in through MetaApi. */
  metaapi?: MetaApiClient;
  /** Follow-up work after a successful sync (e.g. queueing AI reviews). Failures are only logged. */
  afterSync?: (account: { id: string; userId: string }) => Promise<void>;
  /** Tells the user their connection needs attention (in-app and email). Failures are only logged. */
  onAccountProblem?: (
    account: { id: string; userId: string; exchange: Exchange },
    message: string,
  ) => Promise<void>;
}

export type SyncOutcome =
  | { status: "SKIPPED"; reason: string }
  | { status: "SUCCEEDED"; fills: number; income: number; positions: number }
  | { status: "NEEDS_USER_ACTION"; code: VerificationFailureCode }
  | { status: "KEY_REMOVED"; reason: "UNSAFE_PERMISSIONS" };

/** Thrown for failures worth retrying later (rate limits, outages); the queue retries with backoff. */
export class RetryableSyncError extends Error {
  constructor(readonly failure: VerificationFailure) {
    super(failure.message);
    this.name = "RetryableSyncError";
  }
}

/**
 * Syncs one exchange account:
 *  1. re-verifies the key once a day (a key that gained trading rights is deleted at once);
 *  2. downloads history from the last cursor (or the start of the exchange's retention) to now,
 *     in windows the exchange accepts, saving the cursor after each window so work is never redone;
 *  3. rebuilds the journal positions of every symbol that changed;
 *  4. replaces the account's live open positions (mark price, unrealised PnL).
 */
export async function syncAccount(
  deps: SyncDeps,
  accountId: string,
  kind: SyncKind,
  /**
   * The queue retries a failed job a few times within minutes. Only the last attempt counts as a
   * failure for the account's longer backoff, so a short outage does not jump to the 6-hour cap.
   */
  opts: { finalAttempt?: boolean } = {},
): Promise<SyncOutcome> {
  const { db } = deps;
  const finalAttempt = opts.finalAttempt ?? true;
  const account = await db.exchangeAccount.findUnique({
    where: { id: accountId },
    include: { credential: true, user: { select: { deletedAt: true, suspendedAt: true } } },
  });
  const connecting =
    account?.status === "CONNECTING" && EXCHANGE_CATALOG[account.exchange].kind === "METATRADER";
  if ((account?.status !== "ACTIVE" && !connecting) || !account?.credential) {
    return { status: "SKIPPED", reason: "account not active" };
  }
  // A job queued before the user was suspended or deleted must not run.
  if (account.user.deletedAt || account.user.suspendedAt) {
    return { status: "SKIPPED", reason: "user not active" };
  }

  let credentials = decrypt(deps.vault, account.id, account.credential);
  if (connecting) {
    const step = await connectMetatrader(deps, { ...account, exchange: "EXNESS" }, credentials);
    if ("outcome" in step) return step.outcome;
    credentials = step.ready;
    // Just verified read-only: no daily re-check needed in this run.
    account.lastVerifiedAt = new Date(deps.now());
  }
  const run = await db.syncRun.create({ data: { accountId, kind } });
  try {
    const reverify = await reverifyIfDue(deps, account, credentials);
    if (reverify) {
      await db.syncRun.update({
        where: { id: run.id },
        data: { status: "FAILED", finishedAt: new Date(deps.now()), errorCode: reverify.status },
      });
      return reverify;
    }
  } catch (err) {
    // The daily key check could not reach the exchange: same backoff as any other failure.
    if (err instanceof RetryableSyncError)
      return handleFailure(deps, run.id, account, err.failure, err, finalAttempt);
    throw err;
  }

  const source = deps.createSource(account.exchange, credentials);
  const now = deps.now();
  const retentionStart = now - source.retentionMs;

  const cursor = await db.syncCursor.findUnique({
    where: { accountId_stream: { accountId, stream: CURSOR_STREAM } },
  });
  const resumeFrom = cursor ? Number(cursor.value) - OVERLAP_MS : retentionStart;
  const since = Math.max(resumeFrom, retentionStart);
  // Recorded when the first download starts, so an interrupted first backfill keeps the true start
  // (the CSV import relies on it to avoid counting trades twice).
  if (!cursor && !account.historyStartsAt) {
    await db.exchangeAccount.update({
      where: { id: accountId },
      data: { historyStartsAt: new Date(since) },
    });
  }

  const totals = { fills: 0, income: 0, positions: 0 };
  try {
    for (let start = since; start < now; ) {
      const end = Math.min(start + source.maxWindowMs, now);
      const batch = await source.fetchHistory({ since: new Date(start), until: new Date(end) });
      const saved = await saveBatch(db, accountId, batch);
      totals.fills += saved.fillsInserted;
      totals.income += saved.incomeInserted;

      const ref = { id: account.id, userId: account.userId, exchange: account.exchange };
      for (const symbol of [...saved.symbols].sort()) {
        totals.positions +=
          source.model === "FILLS"
            ? await rebuildFromFills(db, ref, symbol, saved.changedFrom.get(symbol))
            : await rebuildFromExchange(db, ref, source, symbol);
      }
      await db.syncCursor.upsert({
        where: { accountId_stream: { accountId, stream: CURSOR_STREAM } },
        create: { accountId, stream: CURSOR_STREAM, value: String(end) },
        update: { value: String(end) },
      });
      start = end;
    }
  } catch (err) {
    return handleFailure(deps, run.id, account, source.classify(err), err, finalAttempt);
  }

  // Live positions are secondary: if they cannot be fetched (e.g. a market-data endpoint is down),
  // history still counts as synced and the previous snapshot stays, labelled with its age.
  const ref = { id: account.id, userId: account.userId, exchange: account.exchange };
  const open = await source.fetchOpenPositions().catch((err: unknown) => {
    log.warn("open positions unavailable; keeping previous snapshot", {
      accountId,
      exchange: account.exchange,
      err,
    });
    return null;
  });
  await db.$transaction([
    ...(open
      ? [
          db.openPosition.deleteMany({ where: { accountId } }),
          db.openPosition.createMany({ data: openPositionRows(ref, open, new Date(now)) }),
        ]
      : []),
    db.syncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(deps.now()),
        windowStart: new Date(since),
        windowEnd: new Date(now),
        fillsFetched: totals.fills,
        incomeFetched: totals.income,
        positionsUpserted: totals.positions,
      },
    }),
    db.exchangeAccount.update({
      where: { id: accountId },
      data: {
        lastSyncedAt: new Date(now),
        lastError: null,
        syncFailures: 0,
        syncRetryAt: null,
        historyStartsAt: account.historyStartsAt ?? new Date(since),
        backfillCompletedAt: account.backfillCompletedAt ?? new Date(deps.now()),
      },
    }),
  ]);
  await deps
    .afterSync?.({ id: account.id, userId: account.userId })
    .catch((err: unknown) => log.warn("after-sync step failed", { accountId, err }));
  log.info("sync succeeded", {
    accountId,
    exchange: account.exchange,
    kind,
    ...totals,
    open: open?.length ?? null,
  });
  return { status: "SUCCEEDED", ...totals };
}

function decrypt(
  vault: CredentialVault,
  accountId: string,
  c: {
    keyId: string;
    wrappedDataKey: Uint8Array;
    apiKeyCipher: Uint8Array;
    apiSecretCipher: Uint8Array;
    passphraseCipher: Uint8Array | null;
  },
): ApiCredentials {
  const fields: Record<string, Buffer> = {
    apiKey: Buffer.from(c.apiKeyCipher),
    apiSecret: Buffer.from(c.apiSecretCipher),
  };
  if (c.passphraseCipher) fields.passphrase = Buffer.from(c.passphraseCipher);
  const opened = vault.open(accountId, {
    keyId: c.keyId,
    wrappedDataKey: Buffer.from(c.wrappedDataKey),
    fields,
  });
  return {
    apiKey: opened.apiKey ?? "",
    apiSecret: opened.apiSecret ?? "",
    ...(opened.passphrase ? { passphrase: opened.passphrase } : {}),
  };
}

async function reverifyIfDue(
  deps: SyncDeps,
  account: { id: string; userId: string; exchange: Exchange; lastVerifiedAt: Date | null },
  credentials: ApiCredentials,
): Promise<SyncOutcome | null> {
  if (account.lastVerifiedAt && deps.now() - account.lastVerifiedAt.getTime() < REVERIFY_MS)
    return null;

  const result = await deps.adapters[account.exchange].verifyCredentials(credentials);
  if (result.ok) {
    await deps.db.exchangeAccount.update({
      where: { id: account.id },
      data: {
        lastVerifiedAt: new Date(deps.now()),
        ipRestricted: result.ipRestricted,
        keyExpiresAt: result.keyExpiresAt,
        permissions: result.permissions,
      },
    });
    return null;
  }

  if (result.code === "UNSAFE_PERMISSIONS") {
    // The key gained trading or withdrawal rights after it was connected. Delete it immediately.
    await deps.db.$transaction([
      deps.db.exchangeCredential.deleteMany({ where: { accountId: account.id } }),
      deps.db.openPosition.deleteMany({ where: { accountId: account.id } }),
      deps.db.exchangeAccount.update({
        where: { id: account.id },
        data: {
          status: "INVALID",
          lastError: `This key can now trade or move funds (${(result.details ?? []).join(", ")}), so we deleted it. Connect a new read-only key.`,
        },
      }),
      deps.db.auditLog.create({
        data: {
          actorId: null,
          action: "exchange.key_deleted_unsafe",
          entity: "exchange_account",
          entityId: account.id,
          metadata: { exchange: account.exchange, permissions: result.details ?? [] },
        },
      }),
    ]);
    await deps
      .onAccountProblem?.(
        account,
        "Your API key could trade or move funds, so we deleted it to protect your account. Connect a new read-only key to keep syncing.",
      )
      .catch((err: unknown) => log.warn("account notification failed", { err }));
    log.warn("deleted key that gained unsafe permissions", {
      accountId: account.id,
      exchange: account.exchange,
    });
    return { status: "KEY_REMOVED", reason: "UNSAFE_PERMISSIONS" };
  }

  if (USER_ACTION_CODES.has(result.code)) {
    await markNeedsAction(deps, account, result);
    return { status: "NEEDS_USER_ACTION", code: result.code };
  }
  throw new RetryableSyncError(result);
}

async function handleFailure(
  deps: SyncDeps,
  runId: string,
  account: { id: string; userId: string; exchange: Exchange },
  failure: VerificationFailure,
  err: unknown,
  finalAttempt = true,
): Promise<SyncOutcome> {
  await deps.db.syncRun.update({
    where: { id: runId },
    data: {
      status: "FAILED",
      finishedAt: new Date(deps.now()),
      errorCode: failure.code,
      errorMessage: failure.message,
    },
  });
  if (USER_ACTION_CODES.has(failure.code)) {
    await markNeedsAction(deps, account, failure);
    return { status: "NEEDS_USER_ACTION", code: failure.code };
  }
  if (!finalAttempt) {
    log.warn("sync attempt failed, the queue will retry shortly", {
      accountId: account.id,
      exchange: account.exchange,
      code: failure.code,
      err,
    });
    throw new RetryableSyncError(failure);
  }
  const updated = await deps.db.exchangeAccount.update({
    where: { id: account.id },
    data: { syncFailures: { increment: 1 } },
    select: { syncFailures: true },
  });
  const retryAt = new Date(deps.now() + retryDelayMs(updated.syncFailures));
  await deps.db.exchangeAccount.update({
    where: { id: account.id },
    data: { syncRetryAt: retryAt },
  });
  log.warn("sync failed, will retry", {
    accountId: account.id,
    exchange: account.exchange,
    code: failure.code,
    failures: updated.syncFailures,
    retryAt,
    err,
  });
  throw new RetryableSyncError(failure);
}

const RETRY_BASE_MS = 5 * 60_000;
const RETRY_MAX_MS = 6 * 3_600_000;

/**
 * Scheduler backoff after consecutive failures: 5 min, 10, 20, 40 ... capped at 6 hours, so an
 * exchange outage or regional block never turns into a request storm.
 */
export function retryDelayMs(consecutiveFailures: number): number {
  const exponent = Math.max(0, Math.min(consecutiveFailures - 1, 20));
  return Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_MAX_MS);
}

async function markNeedsAction(
  deps: SyncDeps,
  account: { id: string; userId: string; exchange: Exchange },
  failure: VerificationFailure,
): Promise<void> {
  await deps.db.$transaction([
    // Live positions can no longer be refreshed; stale figures would mislead.
    deps.db.openPosition.deleteMany({ where: { accountId: account.id } }),
    deps.db.exchangeAccount.update({
      where: { id: account.id },
      data: { status: "INVALID", lastError: failure.message },
    }),
    deps.db.auditLog.create({
      data: {
        actorId: null,
        action: "exchange.sync_needs_user_action",
        entity: "exchange_account",
        entityId: account.id,
        metadata: { exchange: account.exchange, reason: failure.code },
      },
    }),
  ]);
  await deps
    .onAccountProblem?.(account, `Syncing stopped: ${failure.message}`)
    .catch((err: unknown) => log.warn("account notification failed", { err }));
  log.warn("sync stopped: user action needed", {
    accountId: account.id,
    exchange: account.exchange,
    code: failure.code,
  });
}
