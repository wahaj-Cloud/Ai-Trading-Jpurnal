import type { Prisma, PrismaClient } from "@atc/db";
import {
  type ApiCredentials,
  type MetaApiClient,
  type MetatraderMetadata,
  newTransactionId,
  provisionStep,
} from "@atc/exchange-adapters";
import { EXCHANGE_CATALOG } from "@atc/shared";
import { log } from "../logger.js";
import type { SyncDeps, SyncOutcome } from "./sync-account.js";

/** How soon a connecting account is checked again when MetaApi gives no time. */
const RECHECK_MS = 60_000;

type ConnectingAccount = {
  id: string;
  userId: string;
  exchange: "EXNESS";
  metadata: Prisma.JsonValue;
  externalAccountId: string | null;
};

const asMetadata = (v: Prisma.JsonValue): MetatraderMetadata => v as unknown as MetatraderMetadata;
const json = (m: MetatraderMetadata) => m as unknown as Prisma.InputJsonValue;

/**
 * Connecting a MetaTrader account takes minutes (MetaApi starts a terminal and logs in), so it runs
 * as repeated short steps from the scheduler. The investor password is stored (encrypted) only
 * until the login is proven read-only; then it is deleted and replaced by the MetaApi account id.
 *
 * Returns the credentials to sync with once ready, or the outcome to report now.
 */
export async function connectMetatrader(
  deps: SyncDeps,
  account: ConnectingAccount,
  credentials: ApiCredentials,
): Promise<{ ready: ApiCredentials } | { outcome: SyncOutcome }> {
  const { db } = deps;
  const client = deps.metaapi;
  const broker = EXCHANGE_CATALOG[account.exchange].name;
  if (!client?.enabled) {
    await db.exchangeAccount.update({
      where: { id: account.id },
      data: {
        lastError: `${broker} syncing is not switched on yet. Your account will connect as soon as it is.`,
        syncRetryAt: new Date(deps.now() + 60 * 60_000),
      },
    });
    return { outcome: { status: "SKIPPED", reason: "metaapi not configured" } };
  }

  let metadata = asMetadata(account.metadata);
  if (!metadata.metaapiAccountId && !metadata.transactionId) {
    // Stored before the first create call, so a retry is recognised as the same request.
    metadata = { ...metadata, transactionId: newTransactionId() };
    await db.exchangeAccount.update({
      where: { id: account.id },
      data: { metadata: json(metadata) },
    });
  }

  const step = await provisionStep(
    client,
    metadata,
    { login: credentials.apiKey, password: credentials.apiSecret },
    { accountId: account.id, brokerName: broker, now: deps.now() },
  );

  if (step.status === "PENDING") {
    const retryAt = step.retryAt && step.retryAt.getTime() > deps.now() ? step.retryAt : null;
    await db.exchangeAccount.update({
      where: { id: account.id },
      data: {
        metadata: json(step.metadata),
        lastError: null,
        syncRetryAt: retryAt ?? new Date(deps.now() + RECHECK_MS),
      },
    });
    return { outcome: { status: "SKIPPED", reason: "connecting" } };
  }

  if (step.status === "FAILED") {
    let meta = step.metadata;
    if (step.remove && meta.metaapiAccountId) {
      // Stop the terminal (and billing) now; if that fails the cleanup pass retries it.
      const removed = await client.remove(meta.metaapiAccountId).then(
        () => true,
        (err: unknown) => {
          log.warn("could not remove MetaApi account yet", { accountId: account.id, err });
          return false;
        },
      );
      if (removed) {
        const { metaapiAccountId: _id, region: _r, deployRequestedAt: _d, ...rest } = meta;
        meta = rest;
      }
    }
    const { transactionId: _t, ...withoutTxn } = meta;
    const details = step.failure.details?.length ? ` ${step.failure.details.join(" ")}` : "";
    await db.$transaction([
      // The password is never kept after a failed login.
      db.exchangeCredential.deleteMany({ where: { accountId: account.id } }),
      db.exchangeAccount.update({
        where: { id: account.id },
        data: {
          status: "INVALID",
          metadata: json(withoutTxn),
          lastError: `${step.failure.message}${details}`,
          syncRetryAt: null,
        },
      }),
      db.auditLog.create({
        data: {
          actorId: null,
          action:
            step.failure.code === "UNSAFE_PERMISSIONS"
              ? "exchange.key_deleted_unsafe"
              : "exchange.connect_rejected",
          entity: "exchange_account",
          entityId: account.id,
          metadata: { exchange: account.exchange, reason: step.failure.code },
        },
      }),
    ]);
    await deps
      .onAccountProblem?.(account, step.failure.message)
      .catch((err: unknown) => log.warn("account notification failed", { err }));
    return { outcome: { status: "NEEDS_USER_ACTION", code: step.failure.code } };
  }

  // READY: logged in read-only. Replace the stored password with the MetaApi account id.
  const metaapiAccountId = step.metadata.metaapiAccountId as string;
  const ready: ApiCredentials = { apiKey: credentials.apiKey, apiSecret: metaapiAccountId };
  const sealed = deps.vault.seal(account.id, { apiKey: ready.apiKey, apiSecret: ready.apiSecret });
  const { transactionId: _t, ...metadataReady } = step.metadata;
  await db.$transaction([
    db.exchangeCredential.update({
      where: { accountId: account.id },
      data: {
        keyId: sealed.keyId,
        wrappedDataKey: new Uint8Array(sealed.wrappedDataKey),
        apiKeyCipher: new Uint8Array(sealed.fields.apiKey),
        apiSecretCipher: new Uint8Array(sealed.fields.apiSecret),
        passphraseCipher: null,
        rotatedAt: new Date(deps.now()),
      },
    }),
    db.exchangeAccount.update({
      where: { id: account.id },
      data: {
        status: "ACTIVE",
        metadata: json(metadataReady),
        externalAccountId:
          account.externalAccountId ??
          `${String(step.info.server).toLowerCase()}:${String(step.info.login)}`,
        permissions: { investorMode: true, tradeAllowed: step.info.tradeAllowed === true },
        lastVerifiedAt: new Date(deps.now()),
        lastError: null,
        syncRetryAt: null,
      },
    }),
    db.auditLog.create({
      data: {
        actorId: null,
        action: "exchange.connected",
        entity: "exchange_account",
        entityId: account.id,
        metadata: { exchange: account.exchange, investorMode: true, currency: step.info.currency },
      },
    }),
  ]);
  log.info("MetaTrader account connected read-only", { accountId: account.id });
  return { ready };
}

/**
 * Keeps the MetaApi bill to accounts that are actually in use: removes cloud terminals of
 * disconnected, failed or deleted connections (and ones replaced by a reconnect), and stops those
 * of suspended users (they restart on the next sync after the suspension is lifted).
 */
export async function cleanupMetatrader(db: PrismaClient, client: MetaApiClient): Promise<number> {
  if (!client.enabled) return 0;
  const accounts = await db.exchangeAccount.findMany({
    where: { exchange: "EXNESS" },
    select: {
      id: true,
      status: true,
      metadata: true,
      user: { select: { deletedAt: true, suspendedAt: true } },
    },
  });
  let changed = 0;
  for (const a of accounts) {
    const meta = asMetadata(a.metadata);
    const retired = meta.retiredMetaapiIds ?? [];
    const gone = a.status === "DISCONNECTED" || a.status === "INVALID" || a.user.deletedAt !== null;
    const toRemove = [
      ...retired,
      ...(gone && meta.metaapiAccountId ? [meta.metaapiAccountId] : []),
    ];
    const failed: string[] = [];
    for (const id of toRemove) {
      try {
        await client.remove(id);
        changed++;
      } catch (err) {
        log.warn("MetaApi account removal failed; will retry", { accountId: a.id, err });
        failed.push(id);
      }
    }
    let next: MetatraderMetadata = meta;
    if (toRemove.length > 0) {
      const { retiredMetaapiIds: _old, ...rest } = meta;
      next = rest;
      if (gone) {
        // The connection is over: its terminal is removed (or queued for removal below).
        const { metaapiAccountId: _id, region: _r, deployRequestedAt: _d, ...withoutId } = next;
        next = withoutId;
      }
      if (failed.length > 0) next = { ...next, retiredMetaapiIds: failed };
    }
    if (a.status === "ACTIVE" && a.user.suspendedAt && next.metaapiAccountId) {
      try {
        await client.undeploy(next.metaapiAccountId);
        changed++;
      } catch (err) {
        log.warn("MetaApi undeploy failed; will retry", { accountId: a.id, err });
      }
    }
    if (next !== meta)
      await db.exchangeAccount.update({ where: { id: a.id }, data: { metadata: json(next) } });
  }
  if (changed > 0) log.info("MetaApi accounts cleaned up", { changed });
  return changed;
}
