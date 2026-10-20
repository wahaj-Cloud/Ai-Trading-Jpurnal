// Integration test: full sync pipeline against real Postgres + Redis and fake exchanges.
// Run after `pnpm build`:
//   DATABASE_URL=postgresql://...localhost... REDIS_URL=redis://localhost:6379 pnpm --filter @atc/worker test:integration
import assert from "node:assert/strict";
import { CredentialVault, parseKeyRing } from "@atc/crypto";
import { createPrismaClient } from "@atc/db";
import { createAdapterRegistry, createHistorySource, MetaApiClient } from "@atc/exchange-adapters";
import { SYNC_JOB_OPTIONS, SYNC_QUEUE, syncJobId } from "@atc/shared";
import { Queue, QueueEvents, Worker } from "bullmq";
import { rewrapCredentials } from "../dist/rotate-keys.js";
import { scheduleDueSyncs } from "../dist/scheduler.js";
import { cleanupMetatrader } from "../dist/sync/metatrader.js";
import { rebuildFromFills } from "../dist/sync/rebuild.js";
import { syncAccount } from "../dist/sync/sync-account.js";
import { startFakeBinance, startFakeMetaApi, startFakeMexc } from "./fake-exchanges.mjs";

const dbUrl = process.env.DATABASE_URL ?? "";
const redisUrl = process.env.REDIS_URL ?? "";
// This test wipes data: refuse to run against anything but local services.
if (
  !/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl) ||
  !/\/\/(localhost|127\.0\.0\.1)[:/]/.test(redisUrl)
) {
  throw new Error("Integration tests only run against local DATABASE_URL and REDIS_URL");
}

const DAY = 86_400_000;
const NOW = Date.now();
const t = (daysAgo, minutes = 0) => NOW - daysAgo * DAY + minutes * 60_000;

// ─── Fake exchange state ───
const readOnly = {
  ipRestrict: true,
  enableReading: true,
  enableWithdrawals: false,
  enableFutures: false,
  enableSpotAndMarginTrading: false,
};
const binance = {
  keys: {
    bnkeyaaaaaaaaaaaaaaaa: {
      secret: "bnsecretaaaaaaaaaaaaa",
      uid: 111,
      restrictions: { ...readOnly },
    },
    bnrevokedaaaaaaaaaaaa: {
      secret: "bnsecretbbbbbbbbbbbbb",
      uid: 222,
      restrictions: { ...readOnly },
    },
  },
  requests: [],
  openPositions: [
    {
      symbol: "ETHUSDT",
      positionSide: "BOTH",
      positionAmt: "1",
      entryPrice: "3000",
      markPrice: "3050",
      unRealizedProfit: "50",
      liquidationPrice: "0",
      notional: "3050",
      initialMargin: "305",
      isolatedWallet: "0",
    },
  ],
  trades: [],
  income: [],
};
let tradeId = 1000;
function trade(symbol, side, qty, price, time, { pnl = "0", fee = "0.1" } = {}) {
  tradeId += 1;
  binance.trades.push({
    id: tradeId,
    orderId: tradeId * 10,
    symbol,
    side,
    positionSide: "BOTH",
    price,
    qty,
    commission: fee,
    commissionAsset: "USDT",
    realizedPnl: pnl,
    maker: false,
    time,
  });
  binance.income.push({
    symbol,
    incomeType: "COMMISSION",
    income: `-${fee}`,
    asset: "USDT",
    time,
    tranId: tradeId,
    tradeId: String(tradeId),
  });
}
// BTC: long 0.1 @60000 (20 days ago), add 0.1 @61000 (12 days ago), close 0.2 @62000 (2 days ago).
// Average entry 60500 -> gross (62000-60500) x 0.2 = 300. Fees 0.1 + 0.1 + 0.5. Funding -1.5.
trade("BTCUSDT", "BUY", "0.1", "60000", t(20));
trade("BTCUSDT", "BUY", "0.1", "61000", t(12));
trade("BTCUSDT", "SELL", "0.2", "62000", t(2), { pnl: "300", fee: "0.5" });
binance.income.push({
  symbol: "BTCUSDT",
  incomeType: "FUNDING_FEE",
  income: "-1.5",
  asset: "USDT",
  time: t(10),
  tranId: 9001,
});
// ETH: open long 1 @3000 (1 day ago), still open.
trade("ETHUSDT", "BUY", "1", "3000", t(1));

const mexc = {
  keys: {
    mxkeyaaaaaaaaaaaaaaaa: {
      secret: "mxsecretaaaaaaaaaaaaa",
      uid: "777",
      permissions: "SPOT_ACCOUNT_READ,CONTRACT_ACCOUNT_READ,CONTRACT_DEAL_READ",
    },
  },
  requests: [],
  // Open short: 5000 contracts x 0.0001 = 0.5 BTC from 64000; fair price 63000 -> +500.
  openPositions: [
    {
      positionId: "m-open",
      symbol: "BTC_USDT",
      positionType: 2,
      openType: 2,
      state: 1,
      holdVol: 5000,
      holdAvgPrice: 64000,
      openAvgPrice: 64000,
      leverage: 10,
      createTime: t(1),
      updateTime: t(1),
    },
  ],
  tickers: [{ symbol: "BTC_USDT", fairPrice: 63000 }],
  positions: [
    {
      positionId: "m1",
      symbol: "BTC_USDT",
      positionType: "2",
      state: "3",
      holdVol: "0",
      closeVol: "2000",
      openAvgPrice: "63000",
      closeAvgPrice: "62000",
      realised: "19.5",
      closeProfitLoss: "20",
      fee: "0.5",
      leverage: "20",
      createTime: String(t(3)),
      updateTime: String(t(2)),
    },
    // Older than the exchange's retention window: must not be imported.
    {
      positionId: "m-old",
      symbol: "BTC_USDT",
      positionType: "1",
      state: "3",
      holdVol: "0",
      closeVol: "1",
      openAvgPrice: "1",
      closeAvgPrice: "1",
      realised: "0",
      closeProfitLoss: "0",
      fee: "0",
      leverage: "1",
      createTime: String(t(200)),
      updateTime: String(t(199)),
    },
  ],
};

const binanceServer = startFakeBinance(4310, binance);
const mexcServer = startFakeMexc(4311, mexc);
const config = {
  binance: { spotBaseUrl: "http://localhost:4310", futuresBaseUrl: "http://localhost:4310" },
  mexc: { baseUrl: "http://localhost:4311" },
};

// ─── Worker dependencies ───
const db = createPrismaClient(dbUrl);
const vault = new CredentialVault(parseKeyRing(`v1:${"Kx9".repeat(20)}`, "v1"));
const deps = {
  db,
  vault,
  adapters: createAdapterRegistry(config),
  createSource: (exchange, credentials) => createHistorySource(exchange, credentials, config),
  now: () => Date.now(),
};

await db.$executeRawUnsafe("TRUNCATE users CASCADE");
const user = await db.user.create({
  data: {
    authProviderId: "sync-user",
    email: "sync@x.io",
    subscription: { create: {} },
    settings: { create: {} },
  },
});

async function connect(exchange, apiKey, apiSecret, extra = {}) {
  const account = await db.exchangeAccount.create({
    data: { userId: user.id, exchange, label: exchange, apiKeyHint: apiKey.slice(-4), ...extra },
  });
  const sealed = vault.seal(account.id, { apiKey, apiSecret });
  await db.exchangeCredential.create({
    data: {
      accountId: account.id,
      keyId: sealed.keyId,
      wrappedDataKey: new Uint8Array(sealed.wrappedDataKey),
      apiKeyCipher: new Uint8Array(sealed.fields.apiKey),
      apiSecretCipher: new Uint8Array(sealed.fields.apiSecret),
    },
  });
  return account;
}
const positionsOf = (accountId) =>
  db.position.findMany({ where: { accountId }, orderBy: { openedAt: "asc" } });

// 1. Binance backfill: fills -> reconstructed positions with fees and funding.
const bn = await connect("BINANCE", "bnkeyaaaaaaaaaaaaaaaa", "bnsecretaaaaaaaaaaaaa");
const first = await syncAccount(deps, bn.id, "BACKFILL");
assert.equal(first.status, "SUCCEEDED");
let [btc, eth, ...rest] = await positionsOf(bn.id);
assert.equal(rest.length, 0);
assert.equal(btc.symbol, "BTCUSDT");
assert.equal(btc.status, "CLOSED");
assert.equal(btc.source, "FILLS");
assert.equal(btc.entryPrice.toString(), "60500");
assert.equal(btc.exitPrice.toString(), "62000");
assert.equal(btc.quantity.toString(), "0.2");
assert.equal(btc.grossPnl.toString(), "300");
assert.equal(btc.fees.toString(), "0.7");
assert.equal(btc.funding.toString(), "-1.5");
assert.equal(btc.netPnl.toString(), "297.8");
assert.equal(btc.baseAsset, "BTC");
assert.equal(btc.holdingSeconds, 18 * 86_400);
assert.equal(eth.status, "OPEN");
assert.equal(await db.positionFill.count({ where: { positionId: btc.id } }), 3);
const [liveEth, ...liveRest] = await db.openPosition.findMany({ where: { accountId: bn.id } });
assert.equal(liveRest.length, 0);
assert.equal(liveEth.symbol, "ETHUSDT");
assert.equal(liveEth.unrealizedPnl.toString(), "50");
assert.equal(liveEth.leverage.toString(), "10");
assert.equal(liveEth.settleAsset, "USDT");
const account1 = await db.exchangeAccount.findUnique({ where: { id: bn.id } });
assert.ok(
  account1.backfillCompletedAt &&
    account1.lastSyncedAt &&
    account1.historyStartsAt &&
    account1.lastVerifiedAt,
);
// Backfill covers ~88 days in 7-day windows: every userTrades call stayed within Binance's limit.
assert.ok(binance.requests.filter((r) => r === "/fapi/v1/income").length >= 12);
console.log(
  "✓ Binance backfill rebuilds positions: entry 60500, exit 62000, net 297.8 after fees and funding; live ETH position +50",
);

// 2. Re-running is idempotent.
const fillsBefore = await db.fill.count();
const again = await syncAccount(deps, bn.id, "INCREMENTAL");
assert.equal(again.status, "SUCCEEDED");
assert.equal(await db.fill.count(), fillsBefore);
assert.equal((await positionsOf(bn.id)).length, 2);
console.log("✓ re-sync adds nothing twice");

// 3. New trades close the open ETH position; the journal row keeps its identity.
trade("ETHUSDT", "SELL", "1", "3100", Date.now() - 60_000, { pnl: "100" });
binance.openPositions = [];
await syncAccount(deps, bn.id, "INCREMENTAL");
[btc, eth] = await positionsOf(bn.id);
assert.equal(eth.status, "CLOSED");
assert.equal(eth.grossPnl.toString(), "100");
assert.equal((await positionsOf(bn.id)).length, 2);
assert.equal(await db.openPosition.count({ where: { accountId: bn.id } }), 0);
console.log("✓ incremental sync closes an open position in place and clears the live view");

// 3b. Incremental rebuilds (from the last flat point) give exactly what a full rebuild gives, and
//     only touch the recent part of history.
trade("BTCUSDT", "BUY", "0.3", "63000", Date.now() - 50_000);
trade("BTCUSDT", "SELL", "0.3", "63500", Date.now() - 40_000, { pnl: "150" });
await syncAccount(deps, bn.id, "INCREMENTAL");
const snapshot = async () =>
  (await positionsOf(bn.id)).map((p) => [
    p.sourceKey,
    p.status,
    String(p.netPnl),
    String(p.fees),
    String(p.funding),
    p.incompleteHistory,
  ]);
const incremental = await snapshot();
assert.equal(incremental.length, 3);
const oldBtcUpdatedAt = (await positionsOf(bn.id))[0].updatedAt;
const ref = { id: bn.id, userId: user.id, exchange: "BINANCE" };
assert.equal(await rebuildFromFills(db, ref, "BTCUSDT", new Date(Date.now() - 55_000)), 1);
assert.equal(
  (await positionsOf(bn.id))[0].updatedAt.getTime(),
  oldBtcUpdatedAt.getTime(),
  "the older closed trade was not rewritten",
);
for (const symbol of ["BTCUSDT", "ETHUSDT"]) await rebuildFromFills(db, ref, symbol);
assert.deepEqual(await snapshot(), incremental, "full rebuild matches the incremental one");
console.log("✓ incremental rebuild matches a full rebuild and leaves older trades untouched");

// 4. MEXC: positions taken as the exchange computed them; contracts converted to coins.
const mx = await connect("MEXC", "mxkeyaaaaaaaaaaaaaaaa", "mxsecretaaaaaaaaaaaaa");
assert.equal((await syncAccount(deps, mx.id, "BACKFILL")).status, "SUCCEEDED");
const [short, ...mexcRest] = await positionsOf(mx.id);
assert.equal(mexcRest.length, 0, "positions older than retention are not imported");
assert.equal(short.source, "EXCHANGE");
assert.equal(short.direction, "SHORT");
assert.equal(short.quantity.toString(), "0.2"); // 2000 contracts x 0.0001
assert.equal(short.netPnl.toString(), "19.5");
assert.equal(short.leverage.toString(), "20");
const [mxLive] = await db.openPosition.findMany({ where: { accountId: mx.id } });
assert.equal(mxLive.quantity.toString(), "0.5");
assert.equal(mxLive.markPrice.toString(), "63000");
assert.equal(mxLive.unrealizedPnl.toString(), "500");
assert.equal(mxLive.marginMode, "CROSS");
// Market data outage: history still syncs, the previous live snapshot is kept.
mexc.tickerDown = true;
assert.equal((await syncAccount(deps, mx.id, "INCREMENTAL")).status, "SUCCEEDED");
assert.equal((await db.openPosition.findFirst({ where: { accountId: mx.id } })).id, mxLive.id);
assert.equal((await db.exchangeAccount.findUnique({ where: { id: mx.id } })).syncFailures, 0);
mexc.tickerDown = false;
console.log(
  "✓ MEXC positions imported as reported, sizes converted; live PnL from fair price; ticker outage does not fail the sync",
);

// 5. A revoked key stops syncing with a clear message.
const revoked = await connect("BINANCE", "bnrevokedaaaaaaaaaaaa", "bnsecretbbbbbbbbbbbbb", {
  lastVerifiedAt: new Date(),
});
binance.keys.bnrevokedaaaaaaaaaaaa.revoked = true;
const out = await syncAccount(deps, revoked.id, "BACKFILL");
assert.deepEqual(out, { status: "NEEDS_USER_ACTION", code: "INVALID_KEY" });
const revokedRow = await db.exchangeAccount.findUnique({ where: { id: revoked.id } });
assert.equal(revokedRow.status, "INVALID");
assert.match(revokedRow.lastError, /rejected this API Key/);
assert.equal((await db.syncRun.findFirst({ where: { accountId: revoked.id } })).status, "FAILED");
console.log("✓ revoked key: account marked invalid with a fix-it message");

// 6. A key that gained trading rights is deleted at the daily re-check.
await db.openPosition.create({
  data: {
    userId: user.id,
    accountId: bn.id,
    exchange: "BINANCE",
    externalId: "SOLUSDT:BOTH",
    symbol: "SOLUSDT",
    baseAsset: "SOL",
    quoteAsset: "USDT",
    settleAsset: "USDT",
    direction: "LONG",
    quantity: "1",
    syncedAt: new Date(),
  },
});
binance.keys.bnkeyaaaaaaaaaaaaaaaa.restrictions.enableFutures = true;
await db.exchangeAccount.update({
  where: { id: bn.id },
  data: { lastVerifiedAt: new Date(Date.now() - 2 * DAY) },
});
assert.deepEqual(await syncAccount(deps, bn.id, "INCREMENTAL"), {
  status: "KEY_REMOVED",
  reason: "UNSAFE_PERMISSIONS",
});
assert.equal(await db.exchangeCredential.count({ where: { accountId: bn.id } }), 0);
assert.match(
  (await db.exchangeAccount.findUnique({ where: { id: bn.id } })).lastError,
  /Enable Futures/,
);
assert.equal((await positionsOf(bn.id)).length, 3, "history is kept");
assert.equal(
  await db.openPosition.count({ where: { accountId: bn.id } }),
  0,
  "stale live view removed",
);
console.log("✓ key that gained trading rights is deleted; history kept");

// 7. Scheduler + queue: due accounts are queued once, then processed by a real BullMQ worker.
const connection = { url: redisUrl, maxRetriesPerRequest: null };
const queue = new Queue(`${SYNC_QUEUE}-itest`, { connection });
await queue.obliterate({ force: true });
await db.exchangeAccount.update({
  where: { id: mx.id },
  data: { lastSyncedAt: new Date(Date.now() - DAY) },
});
assert.equal(await scheduleDueSyncs(db, queue, 5), 1); // only MEXC is active and due
await scheduleDueSyncs(db, queue, 5); // second tick: same job ID, no duplicate
assert.equal((await queue.getJobCounts("waiting")).waiting, 1);
const events = new QueueEvents(`${SYNC_QUEUE}-itest`, { connection });
await events.waitUntilReady();
const job = await queue.getJob(syncJobId(mx.id));
const worker = new Worker(
  `${SYNC_QUEUE}-itest`,
  async (j) => syncAccount(deps, j.data.accountId, j.data.kind),
  { connection },
);
const result = await job.waitUntilFinished(events, 30_000);
assert.equal(result.status, "SUCCEEDED");
assert.equal(SYNC_JOB_OPTIONS.removeOnComplete, true);
console.log("✓ scheduler queues each due account once; worker processes it");
// The rest of the test drives syncs directly; stop the queue worker so it cannot run the same
// account at the same moment (production never does: one job ID per account).
await worker.close();

// 8. An exchange outage backs off per account instead of retrying every minute.
mexc.down = true;
await db.exchangeAccount.update({
  where: { id: mx.id },
  data: { lastSyncedAt: new Date(Date.now() - DAY) },
});
await assert.rejects(syncAccount(deps, mx.id, "INCREMENTAL"), { name: "RetryableSyncError" });
let backoff = await db.exchangeAccount.findUnique({ where: { id: mx.id } });
assert.equal(backoff.syncFailures, 1);
assert.ok(backoff.syncRetryAt.getTime() - Date.now() > 4 * 60_000);
await queue.obliterate({ force: true });
assert.equal(await scheduleDueSyncs(db, queue, 5), 0, "account in backoff is not queued");
assert.equal(
  await scheduleDueSyncs(db, queue, 5, Date.now() + 6 * 60_000),
  1,
  "queued again after the backoff",
);
mexc.down = false;
assert.equal((await syncAccount(deps, mx.id, "INCREMENTAL")).status, "SUCCEEDED");
backoff = await db.exchangeAccount.findUnique({ where: { id: mx.id } });
assert.equal(backoff.syncFailures, 0);
assert.equal(backoff.syncRetryAt, null);
console.log("✓ outage: per-account backoff, no retry storm, reset after success");

// 8b. Exness (MetaTrader through MetaApi): connect in the background with the investor password,
//     prove it is read-only, drop the password, then sync gold trades from deals.
const metaState = {
  token: "metaapi-test-token-0123456789",
  masterPassword: "master-pw",
  currency: "USD",
  seq: 0,
  accounts: {},
  deleted: [],
  requests: [],
  deals: [
    { id: "11", type: "DEAL_TYPE_BALANCE", time: new Date(t(5)).toISOString(), profit: 5000 },
    {
      id: "12",
      type: "DEAL_TYPE_BUY",
      entryType: "DEAL_ENTRY_IN",
      symbol: "XAUUSDm",
      time: new Date(t(3)).toISOString(),
      volume: 0.1,
      price: 2400,
      commission: -0.7,
      swap: 0,
      profit: 0,
      positionId: "900",
    },
    {
      id: "13",
      type: "DEAL_TYPE_SELL",
      entryType: "DEAL_ENTRY_OUT",
      symbol: "XAUUSDm",
      time: new Date(t(2)).toISOString(),
      volume: 0.1,
      price: 2430,
      commission: -0.7,
      swap: -1.2,
      profit: 300,
      positionId: "900",
    },
    {
      id: "14",
      type: "DEAL_TYPE_SELL",
      entryType: "DEAL_ENTRY_IN",
      symbol: "EURUSDm",
      time: new Date(t(1)).toISOString(),
      volume: 1,
      price: 1.1,
      commission: 0,
      swap: 0,
      profit: 0,
      positionId: "901",
    },
  ],
  positions: [
    {
      id: 901,
      type: "POSITION_TYPE_SELL",
      symbol: "EURUSDm",
      time: new Date(t(1)).toISOString(),
      openPrice: 1.1,
      currentPrice: 1.095,
      volume: 1,
      unrealizedProfit: 500,
    },
  ],
};
const metaServer = startFakeMetaApi(4302, metaState);
const metaOptions = {
  token: metaState.token,
  provisioningUrl: "http://localhost:4302",
  clientBaseUrl: (region) => `http://localhost:4302/${region}`,
};
const exnessDeps = {
  ...deps,
  metaapi: new MetaApiClient(metaOptions),
  adapters: createAdapterRegistry({ ...config, metaapi: metaOptions }),
  createSource: (exchange, credentials) =>
    createHistorySource(exchange, credentials, { ...config, metaapi: metaOptions }),
};
async function connectExness(password, login = "81234567") {
  const account = await db.exchangeAccount.create({
    data: {
      userId: user.id,
      exchange: "EXNESS",
      label: "Exness gold",
      apiKeyHint: login.slice(-4),
      status: "CONNECTING",
      externalAccountId: `exness-mt5real8:${login}`,
      metadata: { server: "Exness-MT5Real8", platform: "mt5" },
    },
  });
  const sealed = vault.seal(account.id, { apiKey: login, apiSecret: password });
  await db.exchangeCredential.create({
    data: {
      accountId: account.id,
      keyId: sealed.keyId,
      wrappedDataKey: new Uint8Array(sealed.wrappedDataKey),
      apiKeyCipher: new Uint8Array(sealed.fields.apiKey),
      apiSecretCipher: new Uint8Array(sealed.fields.apiSecret),
    },
  });
  return account;
}
const ex = await connectExness("investor-pw");
assert.equal(
  (await scheduleDueSyncs(db, { addBulk: async () => [] }, 5)) >= 1,
  true,
  "connecting accounts are scheduled",
);
// Step 1: the cloud account is created and started; still connecting.
assert.deepEqual(await syncAccount(exnessDeps, ex.id, "BACKFILL"), {
  status: "SKIPPED",
  reason: "connecting",
});
let exRow = await db.exchangeAccount.findUnique({ where: { id: ex.id } });
assert.equal(exRow.status, "CONNECTING");
assert.equal(exRow.metadata.metaapiAccountId, "mt-1");
assert.ok(exRow.syncRetryAt > new Date(), "checked again in a minute");
// Step 2: logged in with the investor password: becomes ACTIVE and syncs in the same run.
await db.exchangeAccount.update({ where: { id: ex.id }, data: { syncRetryAt: null } });
assert.equal((await syncAccount(exnessDeps, ex.id, "BACKFILL")).status, "SUCCEEDED");
exRow = await db.exchangeAccount.findUnique({
  where: { id: ex.id },
  include: { credential: true },
});
assert.equal(exRow.status, "ACTIVE");
assert.deepEqual(exRow.permissions, { investorMode: true, tradeAllowed: false });
assert.equal(exRow.metadata.transactionId, undefined);
const opened = vault.open(ex.id, {
  keyId: exRow.credential.keyId,
  wrappedDataKey: Buffer.from(exRow.credential.wrappedDataKey),
  fields: {
    apiKey: Buffer.from(exRow.credential.apiKeyCipher),
    apiSecret: Buffer.from(exRow.credential.apiSecretCipher),
  },
});
assert.deepEqual(
  opened,
  { apiKey: "81234567", apiSecret: "mt-1" },
  "the password is gone; only the MetaApi id is kept",
);
const exPositions = await positionsOf(ex.id);
const gold = exPositions.find((p) => p.symbol === "XAUUSD");
assert.equal(gold.status, "CLOSED");
assert.equal(gold.direction, "LONG");
assert.equal(gold.quantity.toString(), "10");
assert.equal(gold.grossPnl.toString(), "300");
assert.equal(gold.fees.toString(), "1.4");
assert.equal(gold.funding.toString(), "-1.2");
assert.equal(gold.netPnl.toString(), "297.4");
assert.equal(gold.settleAsset, "USD");
assert.equal(gold.baseAsset, "XAU");
const eur = exPositions.find((p) => p.symbol === "EURUSD");
assert.equal(eur.status, "OPEN");
assert.equal(eur.direction, "SHORT");
const live = await db.openPosition.findMany({ where: { accountId: ex.id } });
assert.equal(live.length, 1);
assert.equal(live[0].quantity.toString(), "100000");
assert.equal(live[0].unrealizedPnl.toString(), "500");
// Re-sync: deals are stored once; positions unchanged.
await db.exchangeAccount.update({
  where: { id: ex.id },
  data: { lastSyncedAt: new Date(Date.now() - DAY) },
});
assert.equal((await syncAccount(exnessDeps, ex.id, "INCREMENTAL")).status, "SUCCEEDED");
assert.equal((await positionsOf(ex.id)).length, 2);
console.log(
  "✓ Exness: connects in the background, proves read-only, drops the password, syncs gold and forex with swaps and commissions",
);

// A trading (master) password is refused, the password deleted and the terminal removed.
const bad = await connectExness("master-pw", "81239999");
await syncAccount(exnessDeps, bad.id, "BACKFILL");
await db.exchangeAccount.update({ where: { id: bad.id }, data: { syncRetryAt: null } });
assert.deepEqual(await syncAccount(exnessDeps, bad.id, "BACKFILL"), {
  status: "NEEDS_USER_ACTION",
  code: "UNSAFE_PERMISSIONS",
});
const badRow = await db.exchangeAccount.findUnique({
  where: { id: bad.id },
  include: { credential: true },
});
assert.equal(badRow.status, "INVALID");
assert.equal(badRow.credential, null, "password deleted");
assert.match(badRow.lastError, /investor \(read-only\) password/);
assert.ok(metaState.deleted.includes("mt-2"), "terminal removed at once");
// A wrong password is reported without keeping it.
const wrong = await connectExness("wrong-password", "81230000");
assert.deepEqual(await syncAccount(exnessDeps, wrong.id, "BACKFILL"), {
  status: "NEEDS_USER_ACTION",
  code: "INVALID_SECRET",
});
assert.equal(await db.exchangeCredential.count({ where: { accountId: wrong.id } }), 0);
console.log(
  "✓ Exness: master password refused and removed; wrong password reported; passwords never kept",
);

// Disconnecting stops billing: the cleanup pass removes the cloud terminal.
await db.$transaction([
  db.exchangeCredential.deleteMany({ where: { accountId: ex.id } }),
  db.exchangeAccount.update({ where: { id: ex.id }, data: { status: "DISCONNECTED" } }),
]);
assert.ok((await cleanupMetatrader(db, exnessDeps.metaapi)) >= 1);
assert.ok(metaState.deleted.includes("mt-1"));
assert.equal(
  (await db.exchangeAccount.findUnique({ where: { id: ex.id } })).metadata.metaapiAccountId,
  undefined,
);
assert.equal(await cleanupMetatrader(db, exnessDeps.metaapi), 0, "nothing left to remove");
assert.ok(
  metaState.requests.every((r) => r),
  "all MetaApi calls authenticated",
);
metaServer.close();
console.log("✓ Exness: disconnecting removes the MetaApi terminal (no more billing)");

// 9. Only the queue's last attempt counts towards the account's backoff.
mexc.down = true;
await assert.rejects(syncAccount(deps, mx.id, "INCREMENTAL", { finalAttempt: false }), {
  name: "RetryableSyncError",
});
assert.equal((await db.exchangeAccount.findUnique({ where: { id: mx.id } })).syncFailures, 0);
mexc.down = false;
console.log("✓ quick queue retries do not inflate the account's backoff");

// 10. Suspended users are not synced, even from a job queued before the suspension.
await db.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });
assert.deepEqual(await syncAccount(deps, mx.id, "INCREMENTAL"), {
  status: "SKIPPED",
  reason: "user not active",
});
await db.user.update({ where: { id: user.id }, data: { suspendedAt: null } });
console.log("✓ suspended users are skipped");

// 11. Master-key rotation: add v2, make it active; the worker re-wraps every credential.
const ring2 = parseKeyRing(`v1:${"Kx9".repeat(20)},v2:${"Zq7".repeat(20)}`, "v2");
const vault2 = new CredentialVault(ring2);
assert.ok((await rewrapCredentials(db, vault2, "v2")) >= 2);
assert.equal(await db.exchangeCredential.count({ where: { keyId: { not: "v2" } } }), 0);
assert.equal(await rewrapCredentials(db, vault2, "v2"), 0, "nothing left to re-wrap");
const v2only = new CredentialVault(parseKeyRing(`v2:${"Zq7".repeat(20)}`, "v2"));
assert.equal(
  (await syncAccount({ ...deps, vault: v2only }, mx.id, "INCREMENTAL")).status,
  "SUCCEEDED",
  "old key no longer needed",
);
console.log("✓ master-key rotation re-wraps every stored key automatically");

await events.close();
await queue.obliterate({ force: true });
await queue.close();
await db.$disconnect();
binanceServer.close();
mexcServer.close();
console.log("All sync integration checks passed");
