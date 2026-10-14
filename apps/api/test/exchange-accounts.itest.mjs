// Integration test: exchange connection flow against a real Postgres and signature-checking fake exchanges.
// Run after `pnpm build`: DATABASE_URL=postgresql://...localhost... pnpm --filter @atc/api test:integration
import "reflect-metadata";
import assert from "node:assert/strict";
import { CredentialVault, parseKeyRing } from "@atc/crypto";
import { createPrismaClient } from "@atc/db";
import { createAdapterRegistry } from "@atc/exchange-adapters";
import { connectExchangeSchema } from "@atc/shared";
import { AuditService } from "../dist/audit/audit.service.js";
import { ExchangeAccountsService } from "../dist/exchange-accounts/exchange-accounts.service.js";
import { PositionsService } from "../dist/positions/positions.service.js";
import { startFakeBinance } from "./fake-binance.mjs";
import { startFakeKucoin } from "./fake-kucoin.mjs";

const dbUrl = process.env.DATABASE_URL ?? "";
// This test wipes the users table: refuse to run against anything but a local database.
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const server = startFakeBinance(4200);
const kucoinServer = startFakeKucoin(4201);
const client = createPrismaClient(dbUrl);
const prisma = { client };
const vault = new CredentialVault(parseKeyRing("v1:" + "Kx9".repeat(20), "v1"));
const adapters = createAdapterRegistry({
  binance: { spotBaseUrl: "http://localhost:4200", futuresBaseUrl: "http://localhost:4200" },
  kucoin: { spotBaseUrl: "http://localhost:4201", futuresBaseUrl: "http://localhost:4201" },
});
// Records queued syncs instead of talking to Redis.
const queued = [];
const fakeQueue = {
  enqueue: async (accountId, kind) => {
    queued.push({ accountId, kind });
    return true;
  },
};
const svc = new ExchangeAccountsService(
  prisma,
  new AuditService(prisma),
  fakeQueue,
  vault,
  adapters,
  {
    EXCHANGE_EGRESS_IPS: ["203.0.113.7"],
  },
);
const meta = { ip: "127.0.0.1", userAgent: "itest" };

await client.$executeRawUnsafe("TRUNCATE users CASCADE");
const mk = (n) =>
  client.user.create({
    data: {
      authProviderId: "u" + n,
      email: `u${n}@x.io`,
      subscription: { create: {} },
      settings: { create: {} },
    },
  });
const alice = await mk(1),
  bob = await mk(2);
const creds = (k, s) => ({ apiKey: k, apiSecret: s });
const expectHttp = async (p, status, re) => {
  try {
    await p;
    assert.fail("expected error");
  } catch (e) {
    assert.equal(e.getStatus?.(), status, e.message);
    if (re) assert.match(JSON.stringify(e.getResponse()), re);
  }
};

// 1. Valid read-only key connects; secret is encrypted at rest and decryptable only for this row.
const a = await svc.connect(
  alice.id,
  { exchange: "BINANCE", label: "Main", ...creds("good1aaaaaaaaaaaaaaa", "secret1aaaaaaaaaaaaa") },
  meta,
);
assert.equal(a.status, "ACTIVE");
assert.equal(a.apiKeyHint, "aaaa");
assert.equal("apiSecret" in a, false);
const row = await client.exchangeCredential.findUnique({ where: { accountId: a.id } });
assert.equal(Buffer.from(row.apiSecretCipher).includes("secret1"), false);
const opened = vault.open(a.id, {
  keyId: row.keyId,
  wrappedDataKey: Buffer.from(row.wrappedDataKey),
  fields: { apiKey: Buffer.from(row.apiKeyCipher), apiSecret: Buffer.from(row.apiSecretCipher) },
});
assert.equal(opened.apiSecret, "secret1aaaaaaaaaaaaa");
console.log("✓ connect read-only key, encrypted at rest");

// 2. Trading/withdrawal key rejected with named permissions (Bob, free slot).
await expectHttp(
  svc.connect(
    bob.id,
    { exchange: "BINANCE", label: "X", ...creds("tradeaaaaaaaaaaaaaaa", "secret3aaaaaaaaaaaaa") },
    meta,
  ),
  422,
  /Enable Withdrawals.*Enable Futures/,
);
assert.equal(await client.exchangeAccount.count({ where: { userId: bob.id } }), 0);
console.log("✓ unsafe key rejected, nothing stored");
// 3. Wrong secret / unknown key.
await expectHttp(
  svc.connect(
    bob.id,
    { exchange: "BINANCE", label: "X", ...creds("good2aaaaaaaaaaaaaaa", "wrongsecretxxxxxxxxx") },
    meta,
  ),
  422,
  /Secret Key does not match/,
);
await expectHttp(
  svc.connect(
    bob.id,
    { exchange: "BINANCE", label: "X", ...creds("unknownkeyxxxxxxxxxx", "secretxxxxxxxxxxxxxx") },
    meta,
  ),
  422,
  /rejected this API Key/,
);
console.log("✓ wrong secret and unknown key give specific messages");
// 4. Free plan limit (1 connection).
await expectHttp(
  svc.connect(
    alice.id,
    { exchange: "BINANCE", label: "Two", ...creds("good2aaaaaaaaaaaaaaa", "secret2aaaaaaaaaaaaa") },
    meta,
  ),
  403,
  /allows 1 exchange connection/,
);
// Parallel connects cannot slip past the limit together.
const carol = await mk(9);
const raced = await Promise.allSettled([
  svc.connect(
    carol.id,
    { exchange: "BINANCE", label: "A", ...creds("good4aaaaaaaaaaaaaaa", "secret4aaaaaaaaaaaaa") },
    meta,
  ),
  svc.connect(
    carol.id,
    { exchange: "BINANCE", label: "B", ...creds("good5aaaaaaaaaaaaaaa", "secret5aaaaaaaaaaaaa") },
    meta,
  ),
]);
assert.deepEqual(raced.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
assert.equal(await client.exchangeAccount.count({ where: { userId: carol.id } }), 1);
console.log("✓ plan limit enforced (also for parallel connects)");
// 5. Duplicate of the same Binance account (after upgrade).
await client.subscription.update({ where: { userId: alice.id }, data: { planCode: "PRO" } });
await expectHttp(
  svc.connect(
    alice.id,
    { exchange: "BINANCE", label: "Dup", ...creds("good1bbbbbbbbbbbbbbb", "secret1bbbbbbbbbbbbb") },
    meta,
  ),
  409,
  /already connected as \\"Main\\"/,
);
console.log("✓ same Binance account cannot be connected twice");
// 6. Reconnect with a key from a different Binance account is refused; same account works.
await expectHttp(
  svc.replaceCredentials(
    alice.id,
    a.id,
    creds("good2aaaaaaaaaaaaaaa", "secret2aaaaaaaaaaaaa"),
    meta,
  ),
  422,
  /different Binance account/,
);
const r = await svc.replaceCredentials(
  alice.id,
  a.id,
  creds("good1bbbbbbbbbbbbbbb", "secret1bbbbbbbbbbbbb"),
  meta,
);
assert.equal(r.ipRestricted, true);
assert.equal(r.apiKeyHint, "bbbb");
assert.ok((await client.exchangeCredential.findUnique({ where: { accountId: a.id } })).rotatedAt);
console.log("✓ reconnect: account switch refused, key rotation works");
// 7. Tenant isolation.
await expectHttp(svc.disconnect(bob.id, a.id, meta), 404);
await expectHttp(
  svc.replaceCredentials(bob.id, a.id, creds("good1aaaaaaaaaaaaaaa", "secret1aaaaaaaaaaaaa"), meta),
  404,
);
console.log("✓ other users cannot touch this connection");
// 8. Disconnect deletes the secret, keeps the account; reconnecting reuses the same row.
await svc.disconnect(alice.id, a.id, meta);
assert.equal(await client.exchangeCredential.count({ where: { accountId: a.id } }), 0);
const again = await svc.connect(
  alice.id,
  {
    exchange: "BINANCE",
    label: "Main again",
    ...creds("good1aaaaaaaaaaaaaaa", "secret1aaaaaaaaaaaaa"),
  },
  meta,
);
assert.equal(again.id, a.id);
console.log("✓ disconnect wipes key; reconnect keeps history row");
// 10. KuCoin: passphrase is verified, stored encrypted, and decrypts back for the sync worker.
const kc = {
  exchange: "KUCOIN",
  label: "KuCoin",
  apiKey: "kucoinreadaaaaaaaaaa",
  apiSecret: "kcsecretaaaaaaaaaaaa",
};
await expectHttp(
  svc.connect(bob.id, { ...kc, passphrase: "wrong-pass" }, meta),
  422,
  /passphrase does not match/,
);
const k = await svc.connect(bob.id, { ...kc, passphrase: "Pass-123!" }, meta);
assert.equal(k.exchange, "KUCOIN");
assert.equal(k.ipRestricted, null);
const kRow = await client.exchangeCredential.findUnique({ where: { accountId: k.id } });
assert.ok(kRow.passphraseCipher);
assert.equal(Buffer.from(kRow.passphraseCipher).includes("Pass-123"), false);
const kOpened = vault.open(k.id, {
  keyId: kRow.keyId,
  wrappedDataKey: Buffer.from(kRow.wrappedDataKey),
  fields: {
    apiKey: Buffer.from(kRow.apiKeyCipher),
    apiSecret: Buffer.from(kRow.apiSecretCipher),
    passphrase: Buffer.from(kRow.passphraseCipher),
  },
});
assert.equal(kOpened.passphrase, "Pass-123!");
console.log("✓ KuCoin passphrase verified, encrypted at rest, recoverable");

// 11. KuCoin trading key rejected by name; replacing a KuCoin key requires the passphrase.
await client.subscription.update({ where: { userId: bob.id }, data: { planCode: "PRO" } });
await expectHttp(
  svc.connect(
    bob.id,
    {
      ...kc,
      apiKey: "kucointradeaaaaaaaaa",
      apiSecret: "kcsecretbbbbbbbbbbbb",
      passphrase: "Pass-456!",
    },
    meta,
  ),
  422,
  /Futures Trading/,
);
await expectHttp(
  svc.replaceCredentials(bob.id, k.id, { apiKey: kc.apiKey, apiSecret: kc.apiSecret }, meta),
  400,
  /passphrase/,
);
await expectHttp(
  svc.replaceCredentials(
    alice.id,
    a.id,
    { ...creds("good1aaaaaaaaaaaaaaa", "secret1aaaaaaaaaaaaa"), passphrase: "nope1234" },
    meta,
  ),
  400,
  /no passphrase/,
);
console.log("✓ KuCoin unsafe key rejected; passphrase rules enforced on replace");

// 12. One user, several exchanges at once.
const multi = await svc.connect(
  bob.id,
  {
    exchange: "BINANCE",
    label: "Binance",
    ...creds("good2aaaaaaaaaaaaaaa", "secret2aaaaaaaaaaaaa"),
  },
  meta,
);
const bobList = await svc.list(bob.id);
assert.deepEqual(bobList.accounts.map((x) => x.exchange).sort(), ["BINANCE", "KUCOIN"]);
assert.equal(multi.exchange, "BINANCE");
console.log("✓ multiple exchanges connected for one user");

// Exness (MetaTrader): saved as CONNECTING for the worker; only when switched on; validated.
const erin = await client.user.create({
  data: {
    authProviderId: "u-erin",
    email: "erin@x.io",
    // Exness is included with Premium (each account costs a MetaApi terminal).
    subscription: { create: { planCode: "PREMIUM" } },
    settings: { create: {} },
  },
});
const exnessInput = {
  exchange: "EXNESS",
  label: "Exness gold",
  login: "81234567",
  password: "investor-pw",
  server: "Exness-MT5Real8",
  platform: "mt5",
};
await expectHttp(
  svc.connect(erin.id, connectExchangeSchema.parse(exnessInput), meta),
  503,
  /not switched on/,
);
const svcExness = new ExchangeAccountsService(
  prisma,
  new AuditService(prisma),
  fakeQueue,
  vault,
  adapters,
  {
    EXCHANGE_EGRESS_IPS: [],
    EXNESS_ENABLED: true,
  },
);
const queuedBefore = queued.length;
const exness = await svcExness.connect(erin.id, connectExchangeSchema.parse(exnessInput), meta);
assert.equal(exness.status, "CONNECTING");
assert.equal(exness.apiKeyHint, "4567");
assert.deepEqual(queued.slice(queuedBefore), [{ accountId: exness.id, kind: "BACKFILL" }]);
const exRow = await client.exchangeAccount.findUnique({
  where: { id: exness.id },
  include: { credential: true },
});
assert.deepEqual(exRow.metadata, { server: "Exness-MT5Real8", platform: "mt5" });
assert.equal(exRow.externalAccountId, "exness-mt5real8:81234567");
assert.ok(
  !Buffer.from(exRow.credential.apiSecretCipher).toString("utf8").includes("investor-pw"),
  "encrypted",
);
await expectHttp(
  svcExness.connect(erin.id, connectExchangeSchema.parse({ ...exnessInput, label: "Again" }), meta),
  409,
  /already connected/,
);
assert.equal(connectExchangeSchema.safeParse({ ...exnessInput, login: "abc" }).success, false);
assert.equal(
  connectExchangeSchema.safeParse({ ...exnessInput, apiKey: "x" }).success,
  false,
  "no API-key fields",
);
// Reconnecting must be the same account; the old MetaApi terminal is listed for removal.
await client.exchangeAccount.update({
  where: { id: exness.id },
  data: {
    status: "INVALID",
    metadata: { server: "Exness-MT5Real8", platform: "mt5", metaapiAccountId: "mt-old" },
  },
});
await expectHttp(
  svcExness.replaceCredentials(
    erin.id,
    exness.id,
    { login: "99999999", password: "x1234", server: "Exness-MT5Real8", platform: "mt5" },
    meta,
  ),
  422,
  /different Exness account/,
);
await expectHttp(
  svcExness.replaceCredentials(erin.id, exness.id, { apiKey: "x", apiSecret: "y" }, meta),
  400,
  /Validation failed/,
);
const reconnected = await svcExness.replaceCredentials(
  erin.id,
  exness.id,
  { login: "81234567", password: "new-investor-pw", server: "Exness-MT5Real8", platform: "mt5" },
  meta,
);
assert.equal(reconnected.status, "CONNECTING");
assert.deepEqual(
  (await client.exchangeAccount.findUnique({ where: { id: exness.id } })).metadata
    .retiredMetaapiIds,
  ["mt-old"],
);
await expectHttp(svcExness.requestSync(erin.id, exness.id, meta), 409, /still connecting/);
// Exness has its own allowance and does not use up a crypto exchange connection.
const premiumLimits = (await client.plan.findUnique({ where: { code: "PREMIUM" } })).limits;
const erinList = await svcExness.list(erin.id);
assert.deepEqual(erinList.limit, { used: 0, max: premiumLimits.exchangeAccounts });
assert.deepEqual(erinList.brokers, { used: 1, max: premiumLimits.brokerAccounts });
// Free has no Exness allowance.
const fay = await client.user.create({
  data: { authProviderId: "u-fay", email: "fay@x.io", settings: { create: {} } },
});
await expectHttp(
  svcExness.connect(
    fay.id,
    connectExchangeSchema.parse({ ...exnessInput, login: "81234568" }),
    meta,
  ),
  403,
  /Pro and Premium/,
);
console.log(
  "✓ Exness: saved as connecting (password encrypted), off unless switched on, same-account reconnects only",
);

// 9. Listing and audit trail.
const list = await svc.list(alice.id);
const proMax = (await client.plan.findUnique({ where: { code: "PRO" } })).limits.exchangeAccounts;
assert.deepEqual(list.limit, { used: 1, max: proMax });
assert.equal(list.brokers.used, 0);
assert.deepEqual(list.egressIps, ["203.0.113.7"]);
const actions = (
  await client.auditLog.findMany({
    where: { entity: "exchange_account" },
    orderBy: { createdAt: "asc" },
  })
).map((l) => l.action);
console.log("✓ list + limits;", "audit:", actions.join(", "));
const leaked = await client.$queryRawUnsafe(
  `SELECT count(*)::int AS n FROM audit_logs WHERE metadata::text ~ 'secret|good1|Pass-|investor-pw'`,
);
assert.equal(leaked[0].n, 0);
console.log("✓ no key material in audit logs");
// 13. Connecting queues the first history download; "Sync now" queues a manual sync.
assert.ok(queued.some((q) => q.accountId === a.id && q.kind === "BACKFILL"));
queued.length = 0;
assert.deepEqual(await svc.requestSync(alice.id, a.id, meta), { queued: true });
assert.deepEqual(queued, [{ accountId: a.id, kind: "BACKFILL" }]);
await expectHttp(svc.requestSync(bob.id, a.id, meta), 404);
const listed = await svc.list(alice.id);
assert.equal(listed.accounts[0].sync.state, "PENDING");
console.log("✓ connect queues the history download; Sync now works; sync state reported");

// 14. CSV import: computes PnL, re-import updates instead of duplicating, synced history is skipped.
const positions = new PositionsService(prisma, new AuditService(prisma));
const csvRow = (over = {}) => ({
  exchange: "BINGX",
  symbol: "ETHUSDT",
  direction: "SHORT",
  opened_at: "2026-03-04T21:05:00.000Z",
  closed_at: "2026-03-05T02:30:00.000Z",
  entry_price: "3410",
  exit_price: "3380.25",
  quantity: "1.2",
  fees: "0.98",
  funding: "0",
  ...over,
});
let res = await positions.importRows(
  alice.id,
  [
    csvRow(),
    csvRow({
      symbol: "BTCUSDT",
      direction: "LONG",
      entry_price: "100",
      exit_price: "110",
      quantity: "2",
      fees: undefined,
      funding: undefined,
    }),
  ],
  meta,
);
assert.deepEqual(res, { imported: 2, updated: 0, skippedAlreadySynced: 0 });
res = await positions.importRows(alice.id, [csvRow()], meta);
assert.deepEqual(res, { imported: 0, updated: 1, skippedAlreadySynced: 0 });
const page = await positions.list(alice.id, { limit: 1 });
assert.equal(page.items.length, 1);
assert.ok(page.nextCursor);
const page2 = await positions.list(alice.id, { limit: 50, cursor: page.nextCursor });
const all = [...page.items, ...page2.items];
const eth = all.find((p) => p.symbol === "ETHUSDT");
// Short 1.2 from 3410 to 3380.25: (3410 - 3380.25) x 1.2 = 35.7; minus fees 0.98 = 34.72
assert.equal(eth.grossPnl, "35.7");
assert.equal(eth.netPnl, "34.72");
assert.equal(eth.source, "CSV");
assert.equal(all.length, 2);
// Alice's Binance account has synced history from 2026-01-01: a Binance row closed after that is skipped.
await client.exchangeAccount.update({
  where: { id: a.id },
  data: { historyStartsAt: new Date("2026-01-01T00:00:00Z") },
});
res = await positions.importRows(
  alice.id,
  [csvRow({ exchange: "BINANCE", closed_at: "2026-03-05T02:30:00.000Z" })],
  meta,
);
assert.deepEqual(res, { imported: 0, updated: 0, skippedAlreadySynced: 1 });
assert.equal((await positions.list(bob.id, { limit: 50 })).items.length, 0, "tenant isolation");
console.log(
  "✓ CSV import: PnL computed, idempotent, overlap with synced history skipped, paged, isolated",
);

await client.$disconnect();
server.close();
kucoinServer.close();
console.log("All exchange-connection integration checks passed");
