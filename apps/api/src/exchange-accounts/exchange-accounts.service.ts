import { planLimits } from "@atc/coach";
import type { CredentialVault } from "@atc/crypto";
import { type ExchangeAccount, Prisma } from "@atc/db";
import type { VerifiedKey } from "@atc/exchange-adapters";
import {
  type ApiKeyConnectInput,
  type ConnectExchangeInput,
  type CredentialsInput,
  credentialsSchema,
  EXCHANGE_CATALOG,
  type ExchangeAccountDto,
  type ExchangeAccountsResponse,
  type MetatraderConnectInput,
  type MetatraderCredentialsInput,
  metatraderCredentialsSchema,
  UNLIMITED,
} from "@atc/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ZodType } from "zod";
import { AuditService } from "../audit/audit.service.js";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SyncQueueService } from "../sync/sync-queue.service.js";
import { type AdapterRegistry, CREDENTIAL_VAULT, EXCHANGE_ADAPTERS } from "./exchange.providers.js";

type Meta = { ip: string | null; userAgent: string | null };
type Tx = Prisma.TransactionClient;

@Injectable()
export class ExchangeAccountsService {
  private readonly logger = new Logger(ExchangeAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly syncQueue: SyncQueueService,
    @Inject(CREDENTIAL_VAULT) private readonly vault: CredentialVault,
    @Inject(EXCHANGE_ADAPTERS) private readonly adapters: AdapterRegistry,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(userId: string): Promise<ExchangeAccountsResponse> {
    const [accounts, max] = await Promise.all([
      this.prisma.client.exchangeAccount.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      }),
      this.accountLimit(userId),
    ]);
    const running = await this.prisma.client.syncRun.findMany({
      where: {
        accountId: { in: accounts.map((a) => a.id) },
        status: "RUNNING",
        // A run older than this was interrupted (e.g. a deploy); it is not really running.
        startedAt: { gt: new Date(Date.now() - STALE_RUN_MS) },
      },
      select: { accountId: true },
    });
    const syncing = new Set(running.map((r) => r.accountId));
    return {
      accounts: accounts.map((a) => toDto(a, syncing.has(a.id))),
      egressIps: this.env.EXCHANGE_EGRESS_IPS,
      limit: { used: accounts.filter((a) => a.status !== "DISCONNECTED").length, max },
    };
  }

  /** Queues an immediate sync ("Sync now"). Only for active connections. */
  async requestSync(userId: string, accountId: string, meta: Meta): Promise<{ queued: boolean }> {
    const account = await this.findOwned(userId, accountId);
    if (account.status === "CONNECTING") {
      throw new ConflictException(
        "This account is still connecting. It syncs as soon as it is ready.",
      );
    }
    if (account.status !== "ACTIVE") {
      throw new ConflictException("This connection is not active. Replace its key to sync again.");
    }
    const queued = await this.syncQueue.enqueue(
      account.id,
      account.backfillCompletedAt ? "MANUAL" : "BACKFILL",
    );
    await this.audit.record({
      actorId: userId,
      action: "exchange.sync_requested",
      entity: "exchange_account",
      entityId: account.id,
      ...meta,
      metadata: { queued },
    });
    return { queued };
  }

  async connect(
    userId: string,
    input: ConnectExchangeInput,
    meta: Meta,
  ): Promise<ExchangeAccountDto> {
    if (input.exchange === "EXNESS") return this.connectMetatrader(userId, input, meta);
    return this.connectApiKey(userId, input, meta);
  }

  /**
   * MetaTrader brokers: logging in takes minutes, so the account is saved as CONNECTING with the
   * investor password encrypted, and the worker finishes the connection (and proves it is
   * read-only) in the background. The password is deleted once that is done.
   */
  private async connectMetatrader(
    userId: string,
    input: MetatraderConnectInput,
    meta: Meta,
  ): Promise<ExchangeAccountDto> {
    const name = exchangeName(input.exchange);
    if (!this.env.EXNESS_ENABLED) {
      throw new ServiceUnavailableException(
        `${name} connections are not switched on yet. Please try again later.`,
      );
    }
    await this.assertBelowLimit(userId);
    await this.assertBrokerAllowed(userId);
    const externalAccountId = metatraderAccountId(input);
    const existing = await this.prisma.client.exchangeAccount.findUnique({
      where: {
        userId_exchange_externalAccountId: { userId, exchange: input.exchange, externalAccountId },
      },
    });
    if (existing && existing.status !== "DISCONNECTED") {
      throw new ConflictException(
        `This ${name} account is already connected as "${existing.label}".`,
      );
    }
    try {
      const account = await this.prisma.client.$transaction(async (tx) => {
        await this.lockAndCheckLimit(tx, userId);
        const data = {
          label: input.label,
          ...connectingFields(input, existing?.metadata ?? null),
        };
        const row = existing
          ? await tx.exchangeAccount.update({ where: { id: existing.id }, data })
          : await tx.exchangeAccount.create({
              data: { userId, exchange: input.exchange, externalAccountId, ...data },
            });
        await this.storeCredentials(
          tx,
          row.id,
          { apiKey: input.login, apiSecret: input.password },
          false,
        );
        return row;
      });
      await this.audit.record({
        actorId: userId,
        action: "exchange.connect_started",
        entity: "exchange_account",
        entityId: account.id,
        ...meta,
        metadata: { exchange: input.exchange, platform: input.platform, reused: Boolean(existing) },
      });
      await this.syncQueue.enqueue(account.id, "BACKFILL");
      return toDto(account, false);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException(`This ${name} account is already connected.`);
      }
      throw err;
    }
  }

  private async connectApiKey(
    userId: string,
    input: ApiKeyConnectInput,
    meta: Meta,
  ): Promise<ExchangeAccountDto> {
    await this.assertBelowLimit(userId);
    const verified = await this.verify(userId, input.exchange, input, meta);

    // Same exchange account seen before for this user: reuse the row so its history stays attached.
    const existing = verified.externalAccountId
      ? await this.prisma.client.exchangeAccount.findUnique({
          where: {
            userId_exchange_externalAccountId: {
              userId,
              exchange: input.exchange,
              externalAccountId: verified.externalAccountId,
            },
          },
        })
      : null;
    if (existing && existing.status !== "DISCONNECTED") {
      throw new ConflictException(
        `This ${exchangeName(input.exchange)} account is already connected as "${existing.label}".`,
      );
    }

    try {
      const account = await this.prisma.client.$transaction(async (tx) => {
        await this.lockAndCheckLimit(tx, userId);
        const row = existing
          ? await tx.exchangeAccount.update({
              where: { id: existing.id },
              data: { label: input.label, ...verifiedFields(input, verified) },
            })
          : await tx.exchangeAccount.create({
              data: {
                userId,
                exchange: input.exchange,
                label: input.label,
                externalAccountId: verified.externalAccountId,
                ...verifiedFields(input, verified),
              },
            });
        await this.storeCredentials(tx, row.id, input, false);
        return row;
      });
      await this.audit.record({
        actorId: userId,
        action: "exchange.connected",
        entity: "exchange_account",
        entityId: account.id,
        ...meta,
        metadata: {
          exchange: input.exchange,
          ipRestricted: verified.ipRestricted,
          reused: Boolean(existing),
        },
      });
      await this.syncQueue.enqueue(
        account.id,
        account.backfillCompletedAt ? "INCREMENTAL" : "BACKFILL",
      );
      return toDto(account, false);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException(
          `This ${exchangeName(input.exchange)} account is already connected.`,
        );
      }
      throw err;
    }
  }

  async replaceCredentials(
    userId: string,
    accountId: string,
    body: unknown,
    meta: Meta,
  ): Promise<ExchangeAccountDto> {
    const account = await this.findOwned(userId, accountId);
    if (EXCHANGE_CATALOG[account.exchange].kind === "METATRADER") {
      return this.reconnectMetatrader(
        userId,
        account,
        parse(metatraderCredentialsSchema, body),
        meta,
      );
    }
    const input = parse(credentialsSchema, body);
    assertPassphraseMatchesExchange(account.exchange, input);
    if (account.status === "DISCONNECTED") await this.assertBelowLimit(userId);

    const verified = await this.verify(userId, account.exchange, input, meta);
    if (
      account.externalAccountId &&
      verified.externalAccountId &&
      account.externalAccountId !== verified.externalAccountId
    ) {
      throw new HttpException(
        {
          message: `This key belongs to a different ${exchangeName(account.exchange)} account. Connect it as a new exchange instead.`,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const updated = await this.prisma.client
      .$transaction(async (tx) => {
        // Reconnecting a disconnected account adds a connection: same locked limit check as connect.
        if (account.status === "DISCONNECTED") await this.lockAndCheckLimit(tx, userId);
        const row = await tx.exchangeAccount.update({
          where: { id: account.id },
          data: {
            externalAccountId: account.externalAccountId ?? verified.externalAccountId,
            ...verifiedFields(input, verified),
          },
        });
        await this.storeCredentials(tx, row.id, input, true);
        return row;
      })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new ConflictException(
            `This ${exchangeName(account.exchange)} account is already connected under another name.`,
          );
        }
        throw err;
      });
    await this.audit.record({
      actorId: userId,
      action: "exchange.credentials_replaced",
      entity: "exchange_account",
      entityId: account.id,
      ...meta,
      metadata: { exchange: account.exchange, previousStatus: account.status },
    });
    await this.syncQueue.enqueue(
      updated.id,
      updated.backfillCompletedAt ? "INCREMENTAL" : "BACKFILL",
    );
    return toDto(updated, false);
  }

  /** New investor password (or server) for a MetaTrader account: it connects again in the background. */
  private async reconnectMetatrader(
    userId: string,
    account: ExchangeAccount,
    input: MetatraderCredentialsInput,
    meta: Meta,
  ): Promise<ExchangeAccountDto> {
    const name = exchangeName(account.exchange);
    if (!this.env.EXNESS_ENABLED) {
      throw new ServiceUnavailableException(
        `${name} connections are not switched on yet. Please try again later.`,
      );
    }
    if (account.externalAccountId && account.externalAccountId !== metatraderAccountId(input)) {
      throw new HttpException(
        {
          message: `These details belong to a different ${name} account. Connect it as a new account instead.`,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const updated = await this.prisma.client.$transaction(async (tx) => {
      if (account.status === "DISCONNECTED") {
        await this.lockAndCheckLimit(tx, userId);
        await this.assertBrokerAllowed(userId, tx);
      }
      const row = await tx.exchangeAccount.update({
        where: { id: account.id },
        data: connectingFields(input, account.metadata),
      });
      await this.storeCredentials(
        tx,
        row.id,
        { apiKey: input.login, apiSecret: input.password },
        true,
      );
      return row;
    });
    await this.audit.record({
      actorId: userId,
      action: "exchange.credentials_replaced",
      entity: "exchange_account",
      entityId: account.id,
      ...meta,
      metadata: { exchange: account.exchange, previousStatus: account.status },
    });
    await this.syncQueue.enqueue(
      account.id,
      updated.backfillCompletedAt ? "INCREMENTAL" : "BACKFILL",
    );
    return toDto(updated, false);
  }

  /** Deletes the stored key immediately; the account row (and future trade history) is kept. */
  async disconnect(userId: string, accountId: string, meta: Meta): Promise<void> {
    const account = await this.findOwned(userId, accountId);
    await this.prisma.client.$transaction([
      this.prisma.client.exchangeCredential.deleteMany({ where: { accountId: account.id } }),
      this.prisma.client.exchangeAccount.update({
        where: { id: account.id },
        data: { status: "DISCONNECTED", lastError: null },
      }),
    ]);
    await this.audit.record({
      actorId: userId,
      action: "exchange.disconnected",
      entity: "exchange_account",
      entityId: account.id,
      ...meta,
      metadata: { exchange: account.exchange },
    });
  }

  private async verify(
    userId: string,
    exchange: ExchangeAccount["exchange"],
    credentials: CredentialsInput,
    meta: Meta,
  ): Promise<VerifiedKey> {
    const adapter = this.adapters[exchange];
    const result = await adapter.verifyCredentials(credentials);
    if (result.ok) return result;

    await this.audit.record({
      actorId: userId,
      action: "exchange.connect_rejected",
      entity: "exchange_account",
      ...meta,
      metadata: { exchange, reason: result.code },
    });
    // Our side or the exchange's side, not something the user can fix: 503, and alert on the causes we must act on.
    if (
      result.code === "RESTRICTED_LOCATION" ||
      result.code === "EXCHANGE_UNAVAILABLE" ||
      result.code === "UNVERIFIABLE_PERMISSIONS"
    ) {
      if (result.code !== "EXCHANGE_UNAVAILABLE") {
        this.logger.error({
          msg: "exchange key verification blocked on our side",
          exchange,
          reason: result.code,
        });
      }
      throw new ServiceUnavailableException(result.message);
    }
    throw new HttpException(
      {
        message: result.message,
        issues: (result.details ?? []).map((d) => ({ path: "permissions", message: d })),
      },
      result.code === "RATE_LIMITED"
        ? HttpStatus.TOO_MANY_REQUESTS
        : HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  private async storeCredentials(
    tx: Tx,
    accountId: string,
    creds: CredentialsInput,
    rotation: boolean,
  ): Promise<void> {
    const { apiKey, apiSecret, passphrase } = creds;
    const sealed = passphrase
      ? this.vault.seal(accountId, { apiKey, apiSecret, passphrase })
      : this.vault.seal(accountId, { apiKey, apiSecret });
    const passphraseCipher: Buffer | undefined = (sealed.fields as { passphrase?: Buffer })
      .passphrase;
    const data = {
      keyId: sealed.keyId,
      wrappedDataKey: new Uint8Array(sealed.wrappedDataKey),
      apiKeyCipher: new Uint8Array(sealed.fields.apiKey),
      apiSecretCipher: new Uint8Array(sealed.fields.apiSecret),
      passphraseCipher: passphraseCipher ? new Uint8Array(passphraseCipher) : null,
    };
    await tx.exchangeCredential.upsert({
      where: { accountId },
      create: { accountId, ...data },
      update: { ...data, rotatedAt: rotation ? new Date() : null },
    });
  }

  /** Tenant isolation: accounts are only ever looked up together with their owner. */
  private async findOwned(userId: string, accountId: string): Promise<ExchangeAccount> {
    const account = await this.prisma.client.exchangeAccount.findFirst({
      where: { id: accountId, userId },
    });
    if (!account) throw new NotFoundException("Exchange connection not found");
    return account;
  }

  private async accountLimit(userId: string): Promise<number> {
    // Same effective-plan rule as the rest of the app (lapsed paid plans fall back to Free).
    return (await planLimits(this.prisma.client, userId)).exchangeAccounts;
  }

  /** Per-user lock, then the plan limit: parallel connects or reconnects cannot all slip through. */
  private async lockAndCheckLimit(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`exchange-accounts:${userId}`}, 0))`;
    await this.assertBelowLimit(userId, tx);
  }

  /**
   * MetaTrader (Exness) connections have their own cap: each one runs a paid cloud terminal at
   * MetaApi, so they are limited by plan (none on Free and Pro by default).
   */
  private async assertBrokerAllowed(
    userId: string,
    db: Prisma.TransactionClient = this.prisma.client,
  ): Promise<void> {
    const [limits, used] = await Promise.all([
      planLimits(this.prisma.client, userId),
      db.exchangeAccount.count({
        where: { userId, exchange: "EXNESS", status: { not: "DISCONNECTED" } },
      }),
    ]);
    const max = limits.brokerAccounts;
    if (max === UNLIMITED || used < max) return;
    throw new ForbiddenException(
      max === 0
        ? "Exness (MetaTrader) accounts are included with the Premium plan. Upgrade to connect one."
        : `Your plan allows ${max} Exness (MetaTrader) account${max === 1 ? "" : "s"}. Disconnect one or upgrade your plan.`,
    );
  }

  private async assertBelowLimit(
    userId: string,
    db: Prisma.TransactionClient = this.prisma.client,
  ): Promise<void> {
    const [max, used] = await Promise.all([
      this.accountLimit(userId),
      db.exchangeAccount.count({
        where: { userId, status: { not: "DISCONNECTED" } },
      }),
    ]);
    if (max !== UNLIMITED && used >= max) {
      throw new ForbiddenException(
        `Your plan allows ${max} exchange connection${max === 1 ? "" : "s"}. Disconnect one or upgrade your plan.`,
      );
    }
  }
}

function verifiedFields(creds: CredentialsInput, v: VerifiedKey) {
  return {
    status: "ACTIVE" as const,
    apiKeyHint: creds.apiKey.slice(-4),
    ipRestricted: v.ipRestricted,
    keyExpiresAt: v.keyExpiresAt,
    permissions: v.permissions,
    lastVerifiedAt: new Date(),
    lastError: null,
  };
}

const STALE_RUN_MS = 30 * 60_000;

function toDto(a: ExchangeAccount, syncing: boolean): ExchangeAccountDto {
  return {
    id: a.id,
    exchange: a.exchange,
    label: a.label,
    status: a.status,
    apiKeyHint: a.apiKeyHint,
    ipRestricted: a.ipRestricted,
    keyExpiresAt: a.keyExpiresAt?.toISOString() ?? null,
    lastVerifiedAt: a.lastVerifiedAt?.toISOString() ?? null,
    sync: {
      state: syncing ? "SYNCING" : a.backfillCompletedAt ? "IDLE" : "PENDING",
      lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
      historyStartsAt: a.historyStartsAt?.toISOString() ?? null,
      backfillCompletedAt: a.backfillCompletedAt?.toISOString() ?? null,
    },
    lastError: a.lastError,
    createdAt: a.createdAt.toISOString(),
  };
}

const exchangeName = (e: ExchangeAccount["exchange"]) => EXCHANGE_CATALOG[e].name;

/** Same broker server and login = same MetaTrader account. */
const metatraderAccountId = (i: { server: string; login: string }) =>
  `${i.server.trim().toLowerCase()}:${i.login}`;

/**
 * Account fields for a MetaTrader account about to (re)connect. A MetaApi terminal from an earlier
 * connection is listed for removal, so it stops being billed.
 */
function connectingFields(
  input: { server: string; platform: "mt4" | "mt5"; login: string },
  previous: Prisma.JsonValue | null,
) {
  const old = (previous ?? {}) as { metaapiAccountId?: string; retiredMetaapiIds?: string[] };
  const retired = [
    ...(old.retiredMetaapiIds ?? []),
    ...(old.metaapiAccountId ? [old.metaapiAccountId] : []),
  ];
  return {
    status: "CONNECTING" as const,
    apiKeyHint: input.login.slice(-4),
    metadata: {
      server: input.server.trim(),
      platform: input.platform,
      ...(retired.length ? { retiredMetaapiIds: retired } : {}),
    },
    permissions: {},
    ipRestricted: null,
    keyExpiresAt: null,
    lastVerifiedAt: null,
    lastError: null,
    syncFailures: 0,
    syncRetryAt: null,
  };
}

function parse<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException({
      message: "Validation failed",
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}

/** Replacing a key has no exchange in the request body, so the passphrase rule is checked here. */
function assertPassphraseMatchesExchange(
  exchange: ExchangeAccount["exchange"],
  input: CredentialsInput,
): void {
  const info = EXCHANGE_CATALOG[exchange];
  if (info.needsPassphrase === Boolean(input.passphrase)) return;
  throw new BadRequestException({
    message: "Validation failed",
    issues: [
      {
        path: "passphrase",
        message: info.needsPassphrase
          ? `${info.name} keys need the passphrase you set when creating the key.`
          : `${info.name} keys have no passphrase.`,
      },
    ],
  });
}
