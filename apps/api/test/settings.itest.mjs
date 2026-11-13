// Integration test: v55 settings and service health.
// - App preferences save per field and merge with what is stored; Me returns them complete.
// - "Download my data" holds the trader's records and nothing of anyone else's, never keys.
// - The public status endpoint and the admin overview report the worker's database check.
import "reflect-metadata";
import assert from "node:assert/strict";
import { createPrismaClient, DB_HEALTH_KEY } from "@atc/db";
import { DEFAULT_APP_PREFS, updateProfileSchema } from "@atc/shared";
import { Redis } from "ioredis";
import { AdminService } from "../dist/admin/admin.service.js";
import { AuditService } from "../dist/audit/audit.service.js";
import { HealthController } from "../dist/health/health.controller.js";
import { ExportService } from "../dist/users/export.service.js";
import { UsersService } from "../dist/users/users.service.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const prisma = { client: db, redis };
const tag = `st${Date.now()}`;
const mk = (n) =>
  db.user.create({
    data: {
      authProviderId: `${tag}_${n}`,
      email: `${tag}${n}@x.io`,
      subscription: { create: { planCode: "PRO", status: "ACTIVE" } },
      settings: { create: {} },
    },
  });
const ann = await mk(1);
const ben = await mk(2);
const users = new UsersService(
  prisma,
  new AuditService(prisma),
  { users: {} },
  {
    ADMIN_EMAILS: new Set(),
  },
);
const meta = { ip: "127.0.0.1", userAgent: "test", requestId: "r" };
const patch = (body) => users.updateProfile(ann.id, updateProfileSchema.parse(body), meta);

// 1. Preferences: defaults, per-field saves merge, invalid values refused by the schema.
assert.deepEqual((await users.getMe(ann.id)).settings.appPrefs, DEFAULT_APP_PREFS);
await patch({ appPrefs: { startPage: "orderflow", accountSizeUsd: 5000 } });
await patch({ appPrefs: { riskPct: 0.75 } });
const prefs = (await users.getMe(ann.id)).settings.appPrefs;
assert.deepEqual(prefs, {
  ...DEFAULT_APP_PREFS,
  startPage: "orderflow",
  accountSizeUsd: 5000,
  riskPct: 0.75,
});
await patch({ appPrefs: { accountSizeUsd: null, reduceMotion: true } });
const cleared = (await users.getMe(ann.id)).settings.appPrefs;
assert.equal(cleared.accountSizeUsd, null);
assert.equal(cleared.reduceMotion, true);
assert.equal(cleared.riskPct, 0.75, "other fields kept");
assert.equal(updateProfileSchema.safeParse({ appPrefs: { riskPct: 50 } }).success, false);
assert.equal((await users.getMe(ben.id)).settings.appPrefs.startPage, "dashboard", "per user");
// A damaged stored value (older build, manual edit) is read without failing.
await db.userSettings.update({
  where: { userId: ben.id },
  data: { appPrefs: { startPage: "nowhere", orderflowWindow: "4h" } },
});
assert.equal((await users.getMe(ben.id)).settings.appPrefs.orderflowWindow, "4h");
assert.equal((await users.getMe(ben.id)).settings.appPrefs.startPage, "dashboard");
console.log("✓ app preferences: per-field saves merge, defaults filled, damaged values tolerated");

// 2. Data export: own records only, keys never included.
const acct = await db.exchangeAccount.create({
  data: {
    userId: ann.id,
    exchange: "BINANCE",
    label: "Main",
    apiKeyHint: "ab12",
    credential: {
      create: {
        keyId: "v1",
        wrappedDataKey: Buffer.from("dek"),
        apiKeyCipher: Buffer.from("SECRET-CIPHERTEXT"),
        apiSecretCipher: Buffer.from("SECRET-CIPHERTEXT"),
      },
    },
  },
});
await db.goal.create({
  data: { userId: ann.id, period: "WEEK", metric: "NET_PNL", target: "100" },
});
await db.goal.create({
  data: { userId: ben.id, period: "WEEK", metric: "NET_PNL", target: "999" },
});
const out = await new ExportService(prisma).export(ann.id);
const text = JSON.stringify(out);
assert.equal(out.format, "wickmentor-export");
assert.equal(out.profile.email, ann.email);
assert.equal(out.exchangeAccounts.length, 1);
assert.equal(out.exchangeAccounts[0].label, "Main");
assert.equal(out.goals.length, 1);
assert.equal(out.goals[0].target.toString(), "100");
assert.ok(!text.includes("SECRET-CIPHERTEXT") && !text.includes("Cipher"), "no key material");
assert.ok(!text.includes(ben.email) && !text.includes("999"), "nothing of another user");
assert.equal(out.profile.settings.appPrefs.riskPct, 0.75);
console.log("✓ data export: the trader's own records, never exchange keys or other users");

// 3. Health: public status and the admin overview read the worker's database check.
const health = new HealthController(prisma);
await redis.del(DB_HEALTH_KEY);
let s = await health.status();
assert.equal(s.database, "ok");
assert.equal(s.since, null);
const down = {
  ok: false,
  problem: "quota",
  message: "The database host refused the connection: the plan's monthly allowance is used up.",
  since: "2026-11-12T15:00:00.000Z",
  checkedAt: "2026-11-12T15:51:00.000Z",
  by: "worker",
};
await redis.set(DB_HEALTH_KEY, JSON.stringify(down), "EX", 60);
const overview = await new AdminService(prisma, new AuditService(prisma)).overview();
assert.equal(overview.database.problem, "quota");
assert.equal(overview.database.ok, false);
// The API still reaches the database here, so the public status says so.
s = await health.status();
assert.equal(s.database, "ok");
// With the database refusing the API too, the page learns since when (no reasons are public).
const brokenDb = createPrismaClient("postgresql://nobody@127.0.0.1:1/none");
s = await new HealthController({ client: brokenDb, redis }).status();
assert.equal(s.database, "down");
assert.equal(s.since, down.since);
assert.ok(!JSON.stringify(s).includes("quota"));
await brokenDb.$disconnect().catch(() => undefined);
await redis.del(DB_HEALTH_KEY);
console.log("✓ service status: public says whether and since when; admins see the reason");

await db.exchangeAccount.delete({ where: { id: acct.id } });
await db.user.deleteMany({ where: { id: { in: [ann.id, ben.id] } } });
await redis.quit();
await db.$disconnect();
console.log("All settings and health checks passed");
