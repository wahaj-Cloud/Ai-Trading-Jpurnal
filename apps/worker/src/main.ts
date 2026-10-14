import { AnthropicModel } from "@atc/coach";
import { CredentialVault, loadKeyRing } from "@atc/crypto";
import { createPrismaClient } from "@atc/db";
import {
  type AdapterConfig,
  createAdapterRegistry,
  createHistorySource,
  fetchCandles,
  MetaApiClient,
  nativeSymbol,
} from "@atc/exchange-adapters";
import { checkRisk, notify, ResendSender, runScheduledNotifications } from "@atc/notify";
import {
  AI_QUEUE,
  type AiJobData,
  BACKTEST_QUEUE,
  type BacktestJobData,
  ENGAGEMENT_QUEUE,
  EXCHANGE_CATALOG,
  type ExchangeId,
  MAINTENANCE_QUEUE,
  MARKET_QUEUE,
  SETUP_SCAN_QUEUE,
  SYNC_QUEUE,
  type SyncJobData,
} from "@atc/shared";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { processAiJob } from "./ai/process.js";
import { queueAutoReviews, scheduleCoachNotes } from "./ai/schedule.js";
import { processBacktest } from "./backtest/process.js";
import { loadEnv } from "./env.js";
import { log } from "./logger.js";
import { runLiquidationMaps } from "./market/liq-map.js";
import { runMarketPulse } from "./market/pulse.js";
import { initMonitoring } from "./monitoring.js";
import { startLiveNews } from "./news/live.js";
import { startOfficialWatcher } from "./news/official.js";
import { ExchangeRateLimiter } from "./rate-limit.js";
import { rewrapCredentials } from "./rotate-keys.js";
import { scheduleDueSyncs } from "./scheduler.js";
import { matchAlertsToTrades, scanSetups } from "./setups/scan.js";
import { cleanupMetatrader } from "./sync/metatrader.js";
import { syncAccount } from "./sync/sync-account.js";

async function main(): Promise<void> {
  const env = loadEnv();
  await initMonitoring(env.SENTRY_DSN, env.NODE_ENV, "worker");
  // family 0: resolve both IPv4 and IPv6 (Railway private networking can be IPv6-only).
  const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null, family: 0 };
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, family: 0 });
  const db = createPrismaClient(env.DATABASE_URL);
  // Parsed at boot: a wrong key ring stops the deploy instead of failing every sync.
  const vault = new CredentialVault(
    await loadKeyRing({
      plain: env.CREDENTIAL_KEYS,
      kms: env.CREDENTIAL_KEYS_KMS,
      activeKeyId: env.CREDENTIAL_ACTIVE_KEY_ID,
    }),
  );
  const limiter = new ExchangeRateLimiter(redis);
  const throttle = (exchange: ExchangeId) => ({
    beforeRequest: (url: URL) => limiter.acquire(exchange, url),
  });

  const adapterConfig: AdapterConfig = {
    binance: {
      spotBaseUrl: env.BINANCE_SPOT_BASE_URL,
      futuresBaseUrl: env.BINANCE_FUTURES_BASE_URL,
      ...throttle("BINANCE"),
    },
    mexc: { baseUrl: env.MEXC_BASE_URL, ...throttle("MEXC") },
    kucoin: {
      spotBaseUrl: env.KUCOIN_SPOT_BASE_URL,
      futuresBaseUrl: env.KUCOIN_FUTURES_BASE_URL,
      ...throttle("KUCOIN"),
    },
    bingx: { baseUrl: env.BINGX_BASE_URL, ...throttle("BINGX") },
    bybit: { baseUrl: env.BYBIT_BASE_URL, ...throttle("BYBIT") },
    okx: { baseUrl: env.OKX_BASE_URL, ...throttle("OKX") },
    metaapi: {
      token: env.METAAPI_TOKEN,
      provisioningUrl: env.METAAPI_PROVISIONING_URL,
      ...throttle("EXNESS"),
    },
  };
  const metaapi = new MetaApiClient(adapterConfig.metaapi);
  const model = new AnthropicModel({
    apiKey: env.ANTHROPIC_API_KEY,
    baseUrl: env.ANTHROPIC_BASE_URL,
    fastModel: env.AI_FAST_MODEL,
    smartModel: env.AI_SMART_MODEL,
  });
  const aiQueue = new Queue<AiJobData>(AI_QUEUE, { connection });
  const coachDeps = {
    db,
    model,
    candles: (
      exchange: ExchangeId,
      p: { symbol: string; baseAsset: string; quoteAsset: string },
      tf: Parameters<typeof fetchCandles>[3],
      from: number,
      to: number,
    ) =>
      fetchCandles(
        exchange,
        adapterConfig,
        nativeSymbol(exchange, p.symbol, p.baseAsset, p.quoteAsset),
        tf,
        from,
        to,
      ),
  };

  const notifyDeps = {
    db,
    email: new ResendSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }),
    appUrl: env.APP_URL,
  };

  const deps = {
    afterSync: async (account: { id: string; userId: string }) => {
      // "Planned" vs "no setup": link new trades to the setup alert they followed.
      await matchAlertsToTrades(db, account.userId).catch((err: unknown) =>
        log.warn("alert matching failed", { err }),
      );
      await queueAutoReviews(db, aiQueue, account.id, new Date(), { reviews: model.enabled });
      await checkRisk(notifyDeps, account.userId);
    },
    onAccountProblem: async (
      account: { id: string; userId: string; exchange: ExchangeId },
      message: string,
    ) => {
      await notify(notifyDeps, {
        userId: account.userId,
        kind: "ACCOUNT",
        title: `${EXCHANGE_CATALOG[account.exchange].name} connection needs attention`,
        body: message,
        link: "/exchanges",
        dedupeKey: `account:${account.id}:${new Date().toISOString().slice(0, 10)}`,
      });
    },
    db,
    vault,
    adapters: createAdapterRegistry(adapterConfig),
    createSource: (exchange: ExchangeId, credentials: Parameters<typeof createHistorySource>[1]) =>
      createHistorySource(exchange, credentials, adapterConfig),
    now: Date.now,
    metaapi,
  };

  const syncQueue = new Queue<SyncJobData>(SYNC_QUEUE, { connection });
  const syncWorker = new Worker<SyncJobData>(
    SYNC_QUEUE,
    async (job) =>
      syncAccount(deps, job.data.accountId, job.data.kind, {
        finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
      }),
    { connection, concurrency: env.SYNC_CONCURRENCY },
  );
  syncWorker.on("failed", (job, err) =>
    log.warn("sync job failed", {
      accountId: job?.data.accountId,
      attempt: job?.attemptsMade,
      err,
    }),
  );

  const onNote = (userId: string, note: { headline: string; focus: string; period: string }) =>
    notify(notifyDeps, {
      userId,
      kind: "COACH_NOTE",
      title: `Coaching for ${note.period}: ${note.headline}`.slice(0, 160),
      body: `Focus next session: ${note.focus}`,
      link: "/journal",
      dedupeKey: `note:${note.period}`,
    });
  const aiWorker = new Worker<AiJobData>(
    AI_QUEUE,
    async (job) =>
      processAiJob(coachDeps, job.data, onNote, {
        finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
      }),
    {
      connection,
      concurrency: env.AI_CONCURRENCY,
    },
  );
  aiWorker.on("failed", (job, err) =>
    log.warn("AI job failed", { kind: job?.data.kind, attempt: job?.attemptsMade, err }),
  );

  // Scheduler ticks across all worker processes (BullMQ job schedulers). Sync scheduling and the
  // slower notification pass run on separate queues so one can never hold up the other.
  const maintenance = new Queue(MAINTENANCE_QUEUE, { connection });
  await maintenance.upsertJobScheduler(
    "schedule-syncs",
    { every: 60_000 },
    { name: "schedule-syncs" },
  );
  // Moved to its own queue (below); removes the old schedule from existing deployments.
  await maintenance.removeJobScheduler("schedule-coach-notes");
  const maintenanceWorker = new Worker(
    MAINTENANCE_QUEUE,
    async (job) => {
      if (job.name !== "schedule-syncs") return;
      const queued = await scheduleDueSyncs(db, syncQueue, env.SYNC_INTERVAL_MINUTES);
      if (queued > 0) log.info("scheduled syncs", { queued });
    },
    { connection, concurrency: 1 },
  );

  const engagement = new Queue(ENGAGEMENT_QUEUE, { connection });
  await engagement.upsertJobScheduler(
    "schedule-engagement",
    { every: 15 * 60_000 },
    { name: "schedule-engagement" },
  );
  const engagementWorker = new Worker(
    ENGAGEMENT_QUEUE,
    async () => {
      // Each step is isolated: a failure in one never skips the other.
      const [sent, notes, rewrapped, cleaned] = await Promise.allSettled([
        runScheduledNotifications(notifyDeps),
        model.enabled ? scheduleCoachNotes(db, aiQueue) : Promise.resolve(0),
        rewrapCredentials(db, vault, env.CREDENTIAL_ACTIVE_KEY_ID),
        cleanupMetatrader(db, metaapi),
      ]);
      if (rewrapped.status === "rejected")
        log.error("credential re-wrap failed", { err: rewrapped.reason });
      if (cleaned.status === "rejected")
        log.error("MetaApi cleanup failed", { err: cleaned.reason });
      if (sent.status === "fulfilled" && sent.value > 0)
        log.info("notifications sent", { sent: sent.value });
      if (sent.status === "rejected")
        log.error("scheduled notifications failed", { err: sent.reason });
      if (notes.status === "fulfilled" && notes.value > 0)
        log.info("scheduled coaching notes", { notes: notes.value });
      if (notes.status === "rejected")
        log.error("coach note scheduling failed", { err: notes.reason });
    },
    { connection, concurrency: 1 },
  );

  // Market Pulse (hourly, at minute 5) and My Setup Alerts (every minute, on candle close).
  const marketDeps = { db, config: adapterConfig, redis };
  const market = new Queue(MARKET_QUEUE, { connection });
  if (env.MARKET_PULSE_ENABLED) {
    await market.upsertJobScheduler(
      "market-pulse",
      { pattern: "5 * * * *" },
      { name: "market-pulse", opts: { removeOnComplete: true, removeOnFail: 50 } },
    );
    // A fresh deployment fills the page straight away instead of waiting for minute 5.
    const latest = await db.marketCorrelation.findFirst({ select: { computedAt: true } });
    if (!latest || Date.now() - latest.computedAt.getTime() > 65 * 60_000)
      await market.add(
        "market-pulse",
        {},
        { jobId: "market-pulse-boot", removeOnComplete: true, removeOnFail: true },
      );
  } else {
    await market.removeJobScheduler("market-pulse");
  }
  if (env.LIQ_MAP_ENABLED) {
    await market.upsertJobScheduler(
      "liquidation-maps",
      { pattern: "*/5 * * * *" },
      { name: "liquidation-maps", opts: { removeOnComplete: true, removeOnFail: 50 } },
    );
    await market.add(
      "liquidation-maps",
      {},
      { jobId: `liquidation-maps-boot-${Date.now()}`, removeOnComplete: true, removeOnFail: true },
    );
  } else {
    await market.removeJobScheduler("liquidation-maps");
  }
  const marketWorker = new Worker(
    MARKET_QUEUE,
    async (job) => {
      if (job.name === "liquidation-maps") {
        const res = await runLiquidationMaps(marketDeps);
        log.info("liquidation maps updated", res);
        return;
      }
      const res = await runMarketPulse(marketDeps);
      log.info("market pulse updated", res);
    },
    { connection, concurrency: 1 },
  );
  const setupScan = new Queue(SETUP_SCAN_QUEUE, { connection });
  await setupScan.upsertJobScheduler(
    "scan-setups",
    { every: 60_000 },
    { name: "scan-setups", opts: { removeOnComplete: true, removeOnFail: 50 } },
  );
  const setupWorker = new Worker(
    SETUP_SCAN_QUEUE,
    async () => {
      const res = await scanSetups({
        db,
        redis,
        config: adapterConfig,
        notify: (n) => notify(notifyDeps, n),
      });
      if (res.alerts > 0) log.info("setup alerts sent", res);
    },
    { connection, concurrency: 1 },
  );
  // Strategy Lab: CPU-heavy, so few at a time; each user has at most one run queued (API rule).
  const backtestWorker = new Worker<BacktestJobData>(
    BACKTEST_QUEUE,
    async (job) => processBacktest(marketDeps, job.data.runId),
    { connection, concurrency: env.BACKTEST_CONCURRENCY, lockDuration: 120_000 },
  );

  // Without "error" listeners, a Redis connection error can crash the process.
  const onError = (name: string) => (err: Error) => log.error(`${name} error`, { err });
  syncWorker.on("error", onError("sync worker"));
  aiWorker.on("error", onError("ai worker"));
  maintenanceWorker.on("error", onError("maintenance worker"));
  engagementWorker.on("error", onError("engagement worker"));
  marketWorker.on("error", onError("market worker"));
  setupWorker.on("error", onError("setup worker"));
  backtestWorker.on("error", onError("backtest worker"));
  market.on("error", onError("market queue"));
  setupScan.on("error", onError("setup queue"));
  marketWorker.on("failed", (_job, err) => log.warn("market pulse failed", { err }));
  setupWorker.on("failed", (_job, err) => log.warn("setup scan failed", { err }));
  syncQueue.on("error", onError("sync queue"));
  aiQueue.on("error", onError("ai queue"));
  maintenance.on("error", onError("maintenance queue"));
  engagement.on("error", onError("engagement queue"));

  // Live economic results: one stream per deployment (run a single worker replica).
  const liveNews = env.TE_STREAM_KEY
    ? startLiveNews({ url: env.TE_STREAM_URL, key: env.TE_STREAM_KEY, db, redis })
    : null;
  // Free live US figures (CPI, PPI, jobs report) straight from the Bureau of Labor Statistics.
  const official = env.BLS_API_KEY
    ? startOfficialWatcher({ key: env.BLS_API_KEY, db, redis })
    : null;

  log.info("worker started", {
    liveNews: liveNews ? "on" : "off",
    officialNews: official ? "on" : "off",
    marketPulse: env.MARKET_PULSE_ENABLED ? "on" : "off",
    liquidationMaps: env.LIQ_MAP_ENABLED ? "on" : "off",
    ai: model.enabled ? env.AI_FAST_MODEL : "off",
    concurrency: env.SYNC_CONCURRENCY,
    intervalMinutes: env.SYNC_INTERVAL_MINUTES,
  });

  const shutdown = async (signal: string) => {
    log.info("worker stopping", { signal });
    liveNews?.stop();
    official?.stop();
    // Let running syncs finish their current step; cursors make any unfinished work resumable.
    await Promise.allSettled([
      syncWorker.close(),
      maintenanceWorker.close(),
      engagementWorker.close(),
      aiWorker.close(),
      marketWorker.close(),
      setupWorker.close(),
      backtestWorker.close(),
    ]);
    await Promise.allSettled([
      syncQueue.close(),
      aiQueue.close(),
      maintenance.close(),
      engagement.close(),
      market.close(),
      setupScan.close(),
      redis.quit(),
      db.$disconnect(),
    ]);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  log.error("worker failed to start", { err });
  process.exit(1);
});
