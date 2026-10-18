// Integration test: AI coach (grades, behaviour flags, reviews, notes, chat, limits) against a real
// Postgres with a deterministic fake model. Run after `pnpm build`.
import "reflect-metadata";
import assert from "node:assert/strict";
import { AiRequestError, FakeModel, reviewTrade, writeNote } from "@atc/coach";
import { createPrismaClient } from "@atc/db";
import { journalInputSchema } from "@atc/shared";
import { processAiJob, RetryableAiError } from "../../worker/dist/ai/process.js";
import { queueAutoReviews, scheduleCoachNotes } from "../../worker/dist/ai/schedule.js";
import { CoachService } from "../dist/coach/coach.service.js";
import { JournalService } from "../dist/positions/journal.service.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const prisma = { client: db };

const REVIEW = {
  summary: "A revenge re-entry after a loss.",
  entryAnalysis: "Entered 3 minutes after a loss.",
  exitAnalysis: "Closed at a loss.",
  riskAnalysis: "Size was double your normal.",
  strategyAnalysis: null,
  mistakes: ["Re-entered too fast"],
  positives: ["Closed the trade"],
  nextTime: "Wait 30 minutes after a loss.",
};
const NOTE = {
  headline: "A day of revenge trading.",
  wentWell: ["You stopped after two losses"],
  costMoney: ["Revenge re-entry cost −80.00"],
  focus: "Pause after every loss.",
};
let failNext = null;
const model = new FakeModel((req) => {
  if (failNext) {
    const err = failNext;
    failNext = null;
    throw err;
  }
  if (req.tool?.name === "record_trade_review") return { toolInput: REVIEW };
  if (req.tool?.name === "record_coaching_note") return { toolInput: NOTE };
  return { text: "You lost today mainly because of one revenge trade." };
});
const queued = [];
const fakeQueue = {
  enqueue: async (data) => {
    queued.push(data);
    return true;
  },
  addBulk: async (jobs) => {
    queued.push(...jobs.map((j) => j.data));
    return jobs;
  },
};
const coach = new CoachService(prisma, model, fakeQueue);
const deps = { db, model };
const journal = new JournalService(prisma);
const expectHttp = async (p, status) => {
  try {
    await p;
    assert.fail("expected error");
  } catch (e) {
    assert.equal(e.getStatus?.(), status, e.message);
  }
};

await db.$executeRawUnsafe("TRUNCATE users CASCADE");
const mk = async (n, plan = "PRO") =>
  db.user.create({
    data: {
      authProviderId: `co${n}`,
      email: `co${n}@x.io`,
      timezone: "UTC",
      subscription: { create: { planCode: plan } },
      settings: { create: {} },
    },
  });
const alice = await mk(1);
const bob = await mk(2);
const account = await db.exchangeAccount.create({
  data: { userId: alice.id, exchange: "BINANCE", label: "Main", apiKeyHint: "abcd" },
});
const now = Date.now();
const MIN = 60_000;
let n = 0;
const pos = (openedMsAgo, holdMin, netPnl, qty = "0.01") => {
  n += 1;
  const openedAt = new Date(now - openedMsAgo);
  return db.position.create({
    data: {
      userId: alice.id,
      accountId: account.id,
      exchange: "BINANCE",
      source: "FILLS",
      sourceKey: `${account.id}|F:c${n}`,
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      settleAsset: "USDT",
      direction: "LONG",
      status: "CLOSED",
      openedAt,
      closedAt: new Date(openedAt.getTime() + holdMin * MIN),
      entryPrice: "60000",
      exitPrice: "59900",
      quantity: qty,
      fees: "0.5",
      funding: "0",
      netPnl,
      holdingSeconds: holdMin * 60,
    },
  });
};
// Yesterday: a loss, then a double-size re-entry 3 minutes later.
// Anchored to yesterday 12:00 UTC so the test passes at any time of day.
const DAY = 86_400_000;
const yNoon = Math.floor((now - DAY) / DAY) * DAY + 12 * 3_600_000;
const loss = await pos(now - yNoon, 30, "-50");
const revenge = await pos(now - (yNoon + 33 * MIN), 20, "-80", "0.02");

// 1. Rules-based grade and flags, available without any AI call.
let review = await coach.tradeReview(alice.id, revenge.id);
assert.equal(review.status, "NONE", "no AI review requested yet: the page offers one");
assert.ok(review.flags.some((f) => f.code === "REVENGE" && f.severity === "HIGH"));
assert.match(review.grade, /^[A-F]\+?$/);
assert.equal(model.calls.length, 0);
console.log(`✓ rules-based grade ${review.grade} and revenge flag without any AI call`);

// 2. The worker writes the AI review; re-running is free; journal edits mark it stale.
assert.equal(
  await processAiJob(deps, { kind: "REVIEW_TRADE", userId: alice.id, positionId: revenge.id }),
  "DONE",
);
review = await coach.tradeReview(alice.id, revenge.id);
assert.equal(review.status, "DONE");
assert.equal(review.nextTime, REVIEW.nextTime);
assert.equal(review.stale, false);
const callsAfterFirst = model.calls.length;
await reviewTrade(deps, alice.id, revenge.id);
assert.equal(model.calls.length, callsAfterFirst, "an up-to-date review is not regenerated");
assert.match(model.calls[0].messages[0].content, /Revenge trading \(high\)/);
await journal.save(
  alice.id,
  revenge.id,
  journalInputSchema.parse({ rating: 1, emotions: ["REVENGE"] }),
);
assert.equal((await coach.tradeReview(alice.id, revenge.id)).stale, true);
const usage = await db.usageCounter.findFirst({
  where: { userId: alice.id, metric: "ai_trade_review" },
});
assert.equal(usage.count, 1);
console.log("✓ AI review written once, reused, and flagged stale after a journal edit");

// 3. A temporary AI failure retries later and gives the reserved review back.
failNext = new AiRequestError(529, "overloaded", true);
await assert.rejects(
  processAiJob(deps, {
    kind: "REVIEW_TRADE",
    userId: alice.id,
    positionId: revenge.id,
    force: true,
  }),
  RetryableAiError,
);
assert.equal(
  (await db.usageCounter.findFirst({ where: { userId: alice.id, metric: "ai_trade_review" } }))
    .count,
  1,
  "usage released",
);
assert.equal((await coach.tradeReview(alice.id, revenge.id)).status, "DONE", "earlier review kept");
// On the queue's last attempt the failure is recorded, so the page stops waiting.
failNext = new AiRequestError(529, "overloaded", true);
assert.equal(
  await processAiJob(
    deps,
    { kind: "REVIEW_TRADE", userId: alice.id, positionId: loss.id },
    undefined,
    { finalAttempt: true },
  ),
  "FAILED",
);
assert.equal((await coach.tradeReview(alice.id, loss.id)).status, "FAILED");
console.log(
  "✓ temporary AI failure: retried by the queue, usage given back, old review kept, last attempt recorded",
);

// 4. Plan limit: reviews stop at the limit with a clear status; grades still work.
const month = new Date().toISOString().slice(0, 7);
await db.usageCounter.update({
  where: { userId_metric_period: { userId: alice.id, metric: "ai_trade_review", period: month } },
  data: { count: 300 },
});
const limited = await reviewTrade(deps, alice.id, loss.id);
assert.equal(limited.status, "LIMIT_REACHED");
assert.ok(limited.grade);
await db.usageCounter.updateMany({ where: { userId: alice.id }, data: { count: 0 } });
console.log("✓ monthly review limit enforced atomically; grade still shown");

// 5. Request from the app: marked pending and queued; open/foreign trades refused.
queued.length = 0;
const pending = await coach.requestReview(alice.id, loss.id, false);
assert.equal(pending.status, "PENDING");
assert.deepEqual(queued[0], {
  kind: "REVIEW_TRADE",
  userId: alice.id,
  positionId: loss.id,
  force: false,
});
await expectHttp(coach.requestReview(bob.id, loss.id, false), 404);
console.log("✓ review requests queue work for the worker; other users' trades refused");

// 6. Daily note for yesterday; nothing for a day without trades.
const yesterday = new Date(now - DAY).toISOString().slice(0, 10);
const note = await writeNote(deps, alice.id, "DAILY", yesterday);
assert.equal(note.headline, NOTE.headline);
assert.equal(note.stats.trades, 2);
assert.ok(note.flags.some((f) => f.code === "REVENGE"));
assert.equal(await writeNote(deps, alice.id, "DAILY", "2020-01-01"), null);
assert.equal((await coach.notes(alice.id, 10)).length, 1);
// "Coach me on this day" is capped per day; the counter resets on UTC days.
await db.usageCounter.create({
  data: {
    userId: alice.id,
    metric: "ai_coach_note_request",
    period: new Date().toISOString().slice(0, 10),
    count: 10,
  },
});
await assert.rejects(
  writeNote(deps, alice.id, "DAILY", yesterday, { force: true, onDemand: true }),
  /10 coaching notes a day/,
);
// Days outside a Free plan's history window cannot be coached on demand.
await db.subscription.update({ where: { userId: alice.id }, data: { planCode: "FREE" } });
await assert.rejects(coach.dailyNote(alice.id, "2025-01-01"), /history window/);
await db.subscription.update({ where: { userId: alice.id }, data: { planCode: "PRO" } });
console.log(
  "✓ daily coaching note from the day's facts; none for days without trades; on-demand notes capped",
);

// 7. Schedulers: yesterday's note already exists; auto-reviews only for unreviewed recent trades.
queued.length = 0;
await scheduleCoachNotes(db, fakeQueue);
assert.ok(!queued.some((j) => j.kind === "DAILY_NOTE" && j.date === yesterday));
queued.length = 0;
await queueAutoReviews(db, fakeQueue, account.id, new Date(now));
const reviewsOnly = () => queued.filter((j) => j.kind === "REVIEW_TRADE").map((j) => j.positionId);
assert.deepEqual(reviewsOnly(), [], "both recent trades already have reviews");
assert.ok(
  queued.every((j) => j.kind === "MARKET_CONTEXT"),
  "reviewed trades still get market analysis",
);
const fresh = await pos(10 * MIN, 5, "12");
queued.length = 0;
await queueAutoReviews(db, fakeQueue, account.id, new Date(now));
assert.deepEqual(reviewsOnly(), [fresh.id]);
console.log("✓ schedulers skip existing notes and queue reviews only for new trades");

// 8. Chat: facts reach the model, history is kept, limits and ownership enforced.
const conv = await coach.chat(alice.id, { message: "Why did I lose yesterday?" });
assert.equal(conv.messages.length, 2);
assert.equal(conv.messages[1].role, "ASSISTANT");
const system = model.calls.at(-1).system;
assert.match(system, /<facts>/);
assert.match(system, /LAST 30 DAYS/);
assert.match(system, /Revenge trading/);
const conv2 = await coach.chat(alice.id, {
  conversationId: conv.id,
  message: "And how do I fix it?",
});
assert.equal(conv2.messages.length, 4);
assert.equal(model.calls.at(-1).messages.length, 3, "history + new question");
await expectHttp(coach.conversation(bob.id, conv.id), 404);
await expectHttp(coach.chat(bob.id, { conversationId: conv.id, message: "hi" }), 404);
await db.subscription.update({ where: { userId: bob.id }, data: { planCode: "FREE" } });
for (let i = 0; i < 5; i++) await coach.chat(bob.id, { message: `q${i}` });
await expectHttp(coach.chat(bob.id, { message: "one too many" }), 403);
assert.equal((await coach.status(bob.id)).usage.messagesToday, 5);
console.log("✓ chat uses computed facts and history; daily limit and ownership enforced");

// 9. Without an API key, AI endpoints say so; rules-based insights still work.
const offline = new CoachService(
  prisma,
  { enabled: false, complete: async () => assert.fail() },
  fakeQueue,
);
await expectHttp(offline.chat(alice.id, { message: "hi" }), 503);
assert.equal((await offline.tradeReview(alice.id, loss.id)).status, "UNAVAILABLE");
const behaviour = await offline.behaviour(alice.id, 30);
assert.ok(behaviour.costByBehaviour.some((c) => c.code === "REVENGE"));
console.log("✓ AI switched off: clear 'unavailable', behaviour insights still computed");

// 10. Psychology report: the revenge trade is taxed and the chat sees the score.
const psych = await offline.psychology(alice.id, 30);
assert.ok(psych.trades >= 2);
assert.ok(psych.tax && Number(psych.tax.netPnl) < 0, "flagged trades lost money");
assert.ok(psych.byHabit.some((h) => h.code === "REVENGE"));
assert.equal(psych.trend.length, 8);
assert.match(system, /Psychology|Discipline score|Psychological tax/);
console.log("✓ psychology report: tax from flagged trades, habits, 8-week trend; facts in chat");

await db.$disconnect();
console.log("All AI coach integration checks passed");
