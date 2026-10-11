// Integration test: risk limits, goals, notifications and email against a real Postgres.
// Run after `pnpm build`.
import "reflect-metadata";
import assert from "node:assert/strict";
import { createPrismaClient } from "@atc/db";
import {
  checkRisk,
  deliverPendingEmails,
  EmailError,
  MemorySender,
  notify,
  renderEmail,
  runScheduledNotifications,
} from "@atc/notify";
import { goalInputSchema, notificationPrefsSchema, riskLimitsSchema } from "@atc/shared";
import { EngagementService } from "../dist/engagement/engagement.service.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const svc = new EngagementService({ client: db });
const email = new MemorySender();
// Monday 21 Sept 2026, 22:00 UTC.
const NOW = new Date("2026-09-21T22:00:00Z");
const deps = { db, email, appUrl: "https://app.example.com", now: () => NOW };

await db.$executeRawUnsafe("TRUNCATE users CASCADE");
const mk = (n) =>
  db.user.create({
    data: {
      authProviderId: `en${n}`,
      email: `en${n}@x.io`,
      timezone: "UTC",
      subscription: { create: {} },
      settings: { create: {} },
    },
  });
const alice = await mk(1);
const bob = await mk(2);
const account = await db.exchangeAccount.create({
  data: { userId: alice.id, exchange: "BINANCE", label: "Main", apiKeyHint: "abcd" },
});
let n = 0;
const pos = (closedAt, netPnl) => {
  n += 1;
  return db.position.create({
    data: {
      userId: alice.id,
      accountId: account.id,
      exchange: "BINANCE",
      source: "FILLS",
      sourceKey: `${account.id}|F:e${n}`,
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      settleAsset: "USDT",
      direction: "LONG",
      status: "CLOSED",
      openedAt: new Date(new Date(closedAt).getTime() - 600_000),
      closedAt: new Date(closedAt),
      entryPrice: "100",
      exitPrice: "99",
      quantity: "1",
      netPnl,
      holdingSeconds: 600,
    },
  });
};

// Last week: +300. Today: two losses.
await pos("2026-09-15T10:00:00Z", "300");
await pos("2026-09-21T09:00:00Z", "-50");
await pos("2026-09-21T10:00:00Z", "-35");

// 1. Risk limits: validation, then warnings once per rule and state per day, with email.
assert.equal(riskLimitsSchema.safeParse({ maxDailyLoss: "-5" }).success, false);
await svc.saveRiskLimits(
  alice.id,
  riskLimitsSchema.parse({ maxDailyLoss: "100", maxTradesPerDay: 3 }),
);
await checkRisk(deps, alice.id);
let notes = await db.notification.findMany({
  where: { userId: alice.id },
  orderBy: { createdAt: "asc" },
});
assert.deepEqual(
  notes.map((x) => x.title),
  ["Close to your maximum daily loss"],
);
assert.equal(email.sent.length, 1, "risk warnings are emailed by default");
assert.match(email.sent[0].text, /85\.00, 85% of your daily loss limit/);
await checkRisk(deps, alice.id);
assert.equal(
  await db.notification.count({ where: { userId: alice.id } }),
  1,
  "no duplicate warnings",
);
await pos("2026-09-21T11:00:00Z", "-20");
await checkRisk(deps, alice.id);
notes = await db.notification.findMany({
  where: { userId: alice.id },
  orderBy: { createdAt: "asc" },
});
assert.ok(notes.some((x) => x.title === "Maximum daily loss reached"));
assert.ok(notes.some((x) => x.title === "Close to your maximum trades per day"));
const status = await svc.riskStatus(alice.id);
assert.ok(status.rules.length === 2);
console.log("✓ risk limits: near/breached warnings once per day, emailed");

// 2. Goals: validation, upsert per period+metric, limit on count, tenant isolation.
assert.equal(
  goalInputSchema.safeParse({ period: "WEEK", metric: "WIN_RATE", target: "120" }).success,
  false,
);
await svc.createGoal(
  alice.id,
  goalInputSchema.parse({ period: "WEEK", metric: "NET_PNL", target: "500" }),
);
let goals = await svc.createGoal(
  alice.id,
  goalInputSchema.parse({ period: "WEEK", metric: "NET_PNL", target: "400" }),
);
assert.equal(goals.length, 1, "same period and metric updates the target");
assert.equal(goals[0].target, "400");
await svc.createGoal(
  alice.id,
  goalInputSchema.parse({ period: "MONTH", metric: "MAX_TRADES", target: "50" }),
);
goals = await svc.goals(alice.id);
assert.equal(goals.length, 2);
// The profit goal existed last week too (goals set this week have no result for last week).
await db.goal.updateMany({
  where: { userId: alice.id, metric: "NET_PNL" },
  data: { createdAt: new Date("2026-09-10T00:00:00Z") },
});
await assert.rejects(svc.deleteGoal(bob.id, goals[0].id), /Goal not found/);
console.log("✓ goals: validated, one per period and metric, owner-only delete");

// 3. Scheduled: Monday -> weekly report for last week; 22:00 -> journal reminder; last week's goal result.
email.sent.length = 0;
await runScheduledNotifications(deps);
const titles = (await db.notification.findMany({ where: { userId: alice.id } })).map(
  (x) => x.title,
);
assert.ok(titles.includes("Weekly report: +300.00 USD"), titles.join(" | "));
assert.ok(titles.includes("3 trades to review today"));
assert.ok(titles.some((t) => t.startsWith("Goal missed: net profit (last week)")));
const reminder = await db.notification.findFirst({
  where: { userId: alice.id, kind: "DAILY_REMINDER" },
});
assert.equal(reminder.emailStatus, "NONE", "daily reminders are in-app only by default");
assert.ok(email.sent.some((m) => m.subject === "Weekly report: +300.00 USD"));
const before = await db.notification.count();
await runScheduledNotifications(deps);
assert.equal(await db.notification.count(), before, "scheduler is idempotent");
console.log("✓ scheduler: weekly report, journal reminder, goal result, idempotent");

// 4. Email retries: a temporary failure stays pending and is delivered later.
email.failNext = new EmailError("rate limited", true);
const retried = await notify(deps, {
  userId: alice.id,
  kind: "ACCOUNT",
  title: "Binance connection needs attention",
  body: "Syncing stopped.",
  link: "/exchanges",
  dedupeKey: "account:test",
});
assert.equal(
  (await db.notification.findUnique({ where: { id: retried.id } })).emailStatus,
  "PENDING",
);
await deliverPendingEmails(deps);
assert.equal((await db.notification.findUnique({ where: { id: retried.id } })).emailStatus, "SENT");
console.log("✓ email: temporary failure retried and delivered");

// 5. Preferences: turning a kind off stops its emails; invalid preferences rejected.
assert.equal(notificationPrefsSchema.safeParse({ reminderHour: 25 }).success, false);
await svc.savePrefs(
  alice.id,
  notificationPrefsSchema.parse({ email: { RISK_WARNING: false }, reminderHour: 20 }),
);
email.sent.length = 0;
await notify(deps, {
  userId: alice.id,
  kind: "RISK_WARNING",
  title: "t",
  body: "b",
  dedupeKey: "x1",
});
assert.equal(email.sent.length, 0);
assert.equal((await svc.prefs(alice.id)).reminderHour, 20);
console.log("✓ preferences respected");

// 6. In-app list: paging, unread count, mark read; other users see nothing.
const page = await svc.notifications(alice.id);
assert.ok(page.unread >= 5);
await svc.markRead(alice.id, [page.items[0].id]);
assert.equal(await svc.unreadCount(alice.id), page.unread - 1);
await svc.markRead(bob.id, "all");
assert.equal(await svc.unreadCount(alice.id), page.unread - 1, "another user cannot mark mine");
await svc.markRead(alice.id, "all");
assert.equal(await svc.unreadCount(alice.id), 0);
assert.equal((await svc.notifications(bob.id)).items.length, 0);
console.log("✓ notifications: unread count, mark read, isolation");

// 7. Email rendering escapes content and only links into the app.
const html = renderEmail(
  { title: "<script>x</script>", body: "a & b", link: "https://evil.example" },
  "https://app.example.com",
).html;
assert.ok(!html.includes("<script>x"));
assert.ok(html.includes("&lt;script&gt;"));
assert.ok(!html.includes("evil.example"));
console.log("✓ email templates escape content and never link outside the app");

await db.$disconnect();
console.log("All goals and notifications integration checks passed");
