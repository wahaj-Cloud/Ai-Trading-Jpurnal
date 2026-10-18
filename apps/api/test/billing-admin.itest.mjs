// Integration test: Paddle billing webhooks, plan enforcement and the admin panel. Run after build.
import "reflect-metadata";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { planLimits } from "@atc/coach";
import { createPrismaClient } from "@atc/db";
import { AdminGuard } from "../dist/admin/admin.guard.js";
import { AdminService } from "../dist/admin/admin.service.js";
import { AuditService } from "../dist/audit/audit.service.js";
import { BillingService } from "../dist/billing/billing.service.js";
import { PaddleApi, verifyPaddleSignature } from "../dist/billing/paddle.js";
import { UsersService } from "../dist/users/users.service.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const prisma = { client: db };
const env = {
  PADDLE_ENVIRONMENT: "sandbox",
  PADDLE_PRICES: [
    { plan: "PRO", interval: "month", priceId: "pri_pro_m" },
    { plan: "PRO", interval: "year", priceId: "pri_pro_y" },
    { plan: "PREMIUM", interval: "month", priceId: "pri_prem_m" },
  ],
};
const billing = new BillingService(prisma, env);
const admin = new AdminService(prisma, new AuditService(prisma));

// 1. Signatures.
const secret = "pdl_ntfset_test_secret";
const body = Buffer.from('{"event_id":"evt_1"}');
const now = Date.now();
const ts = Math.floor(now / 1000);
const sign = (t, b) => createHmac("sha256", secret).update(`${t}:`).update(b).digest("hex");
assert.equal(verifyPaddleSignature(body, `ts=${ts};h1=${sign(ts, body)}`, secret, now), true);
assert.equal(
  verifyPaddleSignature(
    Buffer.from('{"event_id":"evt_2"}'),
    `ts=${ts};h1=${sign(ts, body)}`,
    secret,
    now,
  ),
  false,
  "tampered body",
);
assert.equal(
  verifyPaddleSignature(body, `ts=${ts - 600};h1=${sign(ts - 600, body)}`, secret, now),
  false,
  "replayed",
);
assert.equal(
  verifyPaddleSignature(body, `ts=${ts};h1=deadbeef;h1=${sign(ts, body)}`, secret, now),
  true,
  "rotated secrets",
);
assert.equal(verifyPaddleSignature(body, undefined, secret, now), false);
console.log("✓ Paddle signatures: valid accepted; tampered, replayed and missing rejected");

await db.$executeRawUnsafe("TRUNCATE users CASCADE");
await db.$executeRawUnsafe("TRUNCATE billing_events, announcements");
const mk = (n, role = "USER") =>
  db.user.create({
    data: {
      authProviderId: `ba${n}`,
      email: `ba${n}@x.io`,
      role,
      subscription: { create: {} },
      settings: { create: {} },
    },
  });
const alice = await mk(1);
const bob = await mk(2);
const root = await mk(3, "ADMIN");

let seq = 0;
const event = (type, sub, at) => {
  seq += 1;
  return { event_id: `evt_${seq}`, event_type: type, occurred_at: at, data: sub };
};
const sub = (over = {}) => ({
  id: "sub_a",
  status: "active",
  customer_id: "ctm_a",
  items: [{ price: { id: "pri_pro_m" } }],
  current_billing_period: { ends_at: "2026-10-27T00:00:00Z" },
  scheduled_change: null,
  custom_data: { userId: alice.id },
  ...over,
});
const subOf = (u) => db.subscription.findUnique({ where: { userId: u.id } });

// 2. Lifecycle: created -> duplicate -> stale -> cancel scheduled -> paused -> canceled.
const created = event("subscription.created", sub(), "2026-09-27T10:00:00Z");
assert.equal(await billing.handleEvent(created), "APPLIED");
let s = await subOf(alice);
assert.equal(s.planCode, "PRO");
assert.equal(s.status, "ACTIVE");
assert.equal(s.paddleSubscriptionId, "sub_a");
assert.equal((await planLimits(db, alice.id)).exchangeAccounts, 2);
assert.equal(await billing.handleEvent(created), "DUPLICATE");
assert.equal(
  await billing.handleEvent(
    event("subscription.updated", sub({ status: "past_due" }), "2026-09-27T09:00:00Z"),
  ),
  "IGNORED_STALE",
);
assert.equal(
  await billing.handleEvent(
    event(
      "subscription.updated",
      sub({ scheduled_change: { action: "cancel" } }),
      "2026-09-27T11:00:00Z",
    ),
  ),
  "APPLIED",
);
assert.equal((await subOf(alice)).cancelAtPeriodEnd, true);
assert.equal(
  await billing.handleEvent(
    event("subscription.paused", sub({ status: "paused" }), "2026-09-27T12:00:00Z"),
  ),
  "APPLIED",
);
assert.equal(
  (await planLimits(db, alice.id)).exchangeAccounts,
  1,
  "paused paid plan falls back to Free limits",
);
assert.equal(
  await billing.handleEvent(
    event("subscription.canceled", sub({ status: "canceled" }), "2026-09-27T13:00:00Z"),
  ),
  "APPLIED",
);
s = await subOf(alice);
assert.deepEqual(
  [s.planCode, s.status, s.paddleSubscriptionId, s.paddleCustomerId],
  ["FREE", "ACTIVE", null, "ctm_a"],
);
console.log(
  "✓ subscription lifecycle: created, duplicate, out-of-order, cancel scheduled, paused, canceled",
);

// 3. Linking safety: unknown price and unknown user; another user's live subscription is never replaced.
assert.equal(
  await billing.handleEvent(
    event(
      "subscription.created",
      sub({
        id: "sub_b",
        customer_id: "ctm_b",
        custom_data: { userId: bob.id },
        items: [{ price: { id: "pri_other" } }],
      }),
      "2026-09-27T10:00:00Z",
    ),
  ),
  "IGNORED_UNKNOWN_PRICE",
);
assert.equal(
  await billing.handleEvent(
    event(
      "subscription.created",
      sub({ id: "sub_x", customer_id: "ctm_x", custom_data: {} }),
      "2026-09-27T10:00:00Z",
    ),
  ),
  "IGNORED_UNKNOWN_USER",
);
assert.equal(
  await billing.handleEvent(
    event(
      "subscription.created",
      sub({
        id: "sub_b",
        customer_id: "ctm_b",
        custom_data: { userId: bob.id },
        items: [{ price: { id: "pri_prem_m" } }],
      }),
      "2026-09-27T10:05:00Z",
    ),
  ),
  "APPLIED",
);
assert.equal((await subOf(bob)).planCode, "PREMIUM");
assert.equal(
  await billing.handleEvent(
    event(
      "subscription.created",
      sub({ id: "sub_evil", customer_id: "ctm_evil", custom_data: { userId: bob.id } }),
      "2026-09-27T10:06:00Z",
    ),
  ),
  "IGNORED_CONFLICT",
);
assert.equal((await subOf(bob)).paddleSubscriptionId, "sub_b");
assert.equal(
  await billing.handleEvent(event("transaction.completed", {}, "2026-09-27T10:07:00Z")),
  "IGNORED_TYPE",
);
assert.ok((await db.billingEvent.count()) >= 9, "every event recorded");
console.log(
  "✓ webhook safety: unknown prices/users ignored, live subscriptions never hijacked, all events recorded",
);

// 4. Billing page data.
const view = await billing.billing(bob.id);
assert.equal(view.plan.code, "PREMIUM");
assert.equal(view.hasBillingAccount, true);
assert.deepEqual(
  view.offers.find((o) => o.code === "PRO").prices.map((p) => p.interval),
  ["month", "year"],
);
assert.equal(view.checkoutEnabled, true);
console.log("✓ billing status and plan offers with price IDs");

// 5. Admin: guard, overview, search, manual plans, suspension, logs, announcements.
const guard = new AdminGuard();
const ctx = (role) => ({
  switchToHttp: () => ({ getRequest: () => ({ user: { id: "x", role } }) }),
});
assert.throws(() => guard.canActivate(ctx("USER")), /Admins only/);
assert.equal(guard.canActivate(ctx("ADMIN")), true);
const overview = await admin.overview();
assert.equal(overview.users.total, 3);
assert.ok(overview.subscriptions.some((x) => x.plan === "PREMIUM" && x.count === 1));
assert.equal((await admin.users("ba1", undefined)).items.length, 1);
await assert.rejects(
  admin.changePlan(root.id, bob.id, { planCode: "PRO", reason: "test" }),
  /pays online/,
);
const granted = await admin.changePlan(root.id, alice.id, {
  planCode: "ENTERPRISE",
  reason: "Partner account",
});
assert.equal(granted.plan, "ENTERPRISE");
assert.equal(granted.manualPlan, true);
assert.equal(
  await billing.handleEvent(
    event("subscription.updated", sub({ status: "active" }), "2026-09-28T10:00:00Z"),
  ),
  "IGNORED_MANUAL",
);
await assert.rejects(admin.setSuspended(root.id, root.id, true, "oops"), /your own account/);
assert.equal((await admin.setSuspended(root.id, bob.id, true, "Chargeback")).suspended, true);
assert.equal((await admin.setSuspended(root.id, bob.id, false, "Resolved")).suspended, false);
const audit = await admin.auditLog("admin.", undefined);
assert.deepEqual(audit.items.map((a) => a.action).sort(), [
  "admin.plan_changed",
  "admin.user_restored",
  "admin.user_suspended",
]);
assert.equal(audit.items[0].actorEmail, "ba3@x.io");
const a1 = await admin.createAnnouncement(root.id, {
  title: "Maintenance",
  body: "Sync pauses at 02:00 UTC",
  level: "WARNING",
});
assert.equal((await admin.activeAnnouncements()).length, 1);
await admin.endAnnouncement(root.id, a1.id);
assert.equal((await admin.activeAnnouncements(new Date(Date.now() + 1000))).length, 0);
console.log(
  "✓ admin: guard, overview, search, manual plans (not over paid ones), suspension, audit, announcements",
);

// 6. Audit fixes: second subscriptions, late events of an old one, email-checked linking,
//    plan changes through Paddle, manual grants over online payers, concurrent duplicates.
const carol = await mk(4);
const paddleCalls = [];
const fakeFetch = async (url, init = {}) => {
  paddleCalls.push({ url: String(url), method: init.method ?? "GET", body: init.body });
  if (String(url).includes("/customers/ctm_c"))
    return Response.json({ data: { id: "ctm_c", email: "ba4@x.io" } });
  if (String(url).includes("/customers/ctm_mallory"))
    return Response.json({ data: { id: "ctm_mallory", email: "ba4@x.io" } });
  if (String(url).includes("/customers/"))
    return Response.json({ data: { id: "x", email: "someone@else.io" } });
  return Response.json({ data: {} });
};
const live = new BillingService(prisma, { ...env, PADDLE_API_KEY: "k" });
live.paddle = new PaddleApi("k", "sandbox", fakeFetch);
const csub = (over = {}) =>
  sub({ id: "sub_c1", customer_id: "ctm_c", custom_data: { userId: carol.id }, ...over });
// An attacker's checkout naming carol but paid by a customer with another email is refused.
assert.equal(
  await live.handleEvent(
    event(
      "subscription.created",
      csub({ id: "sub_x2", customer_id: "ctm_other" }),
      "2026-10-01T09:00:00Z",
    ),
  ),
  "IGNORED_CONFLICT",
);
assert.equal(
  await live.handleEvent(event("subscription.created", csub(), "2026-10-01T10:00:00Z")),
  "APPLIED",
);
// A second checkout while sub_c1 is live is not linked (and cannot downgrade carol later).
assert.equal(
  await live.handleEvent(
    event(
      "subscription.created",
      csub({ id: "sub_c2", items: [{ price: { id: "pri_prem_m" } }] }),
      "2026-10-01T11:00:00Z",
    ),
  ),
  "IGNORED_CONFLICT",
);
assert.equal(
  await live.handleEvent(
    event(
      "subscription.canceled",
      csub({ id: "sub_c2", status: "canceled" }),
      "2026-10-01T12:00:00Z",
    ),
  ),
  "IGNORED_CONFLICT",
);
assert.deepEqual(
  [(await subOf(carol)).planCode, (await subOf(carol)).paddleSubscriptionId],
  ["PRO", "sub_c1"],
  "the linked subscription is untouched",
);
// A checkout naming another user for an already-linked subscription is refused.
assert.equal(
  await live.handleEvent(
    event(
      "subscription.updated",
      csub({ custom_data: { userId: bob.id } }),
      "2026-10-01T12:30:00Z",
    ),
  ),
  "IGNORED_CONFLICT",
);
// Plan change goes through Paddle's API on the existing subscription (no second checkout).
await assert.rejects(live.changePlan(carol.id, "pri_pro_m"), /already on this plan/);
await assert.rejects(live.changePlan(carol.id, "pri_unknown"), /Unknown price/);
await live.changePlan(carol.id, "pri_prem_m");
const patch = paddleCalls.find((c) => c.method === "PATCH");
assert.match(patch.url, /\/subscriptions\/sub_c1$/);
assert.deepEqual(JSON.parse(patch.body).items, [{ price_id: "pri_prem_m", quantity: 1 }]);
assert.equal(
  await live.handleEvent(
    event(
      "subscription.updated",
      csub({ items: [{ price: { id: "pri_prem_m" } }] }),
      "2026-10-01T13:00:00Z",
    ),
  ),
  "APPLIED",
);
assert.equal((await subOf(carol)).planCode, "PREMIUM");
// Cancel, then a late "active" event of the canceled subscription cannot revive it.
assert.equal(
  await live.handleEvent(
    event("subscription.canceled", csub({ status: "canceled" }), "2026-10-02T10:00:00Z"),
  ),
  "APPLIED",
);
assert.equal(
  await live.handleEvent(
    event("subscription.updated", csub({ status: "active" }), "2026-10-02T09:00:00Z"),
  ),
  "IGNORED_STALE",
);
assert.equal((await subOf(carol)).planCode, "FREE");
// A new subscription after cancellation links normally.
assert.equal(
  await live.handleEvent(
    event(
      "subscription.created",
      csub({ id: "sub_c3", customer_id: "ctm_mallory" }),
      "2026-10-03T10:00:00Z",
    ),
  ),
  "APPLIED",
);
assert.equal((await subOf(carol)).paddleSubscriptionId, "sub_c3");
// Admins cannot put a manual plan over an online subscription (it would ignore cancellations).
await assert.rejects(
  admin.changePlan(root.id, carol.id, { planCode: "PRO", reason: "same plan" }),
  /pays online/,
);
// Concurrent deliveries of one event apply it once.
const twice = event(
  "subscription.updated",
  csub({ id: "sub_c3", customer_id: "ctm_mallory", scheduled_change: { action: "cancel" } }),
  "2026-10-03T11:00:00Z",
);
const outcomes = await Promise.all([live.handleEvent(twice), live.handleEvent(twice)]);
assert.deepEqual(outcomes.sort(), ["APPLIED", "DUPLICATE"]);
console.log(
  "✓ billing hardening: email-checked linking, no second subscriptions, no late revivals, plan changes via Paddle, concurrent duplicates",
);

// 7. Account deletion destroys exchange keys; suspension blocks sign-in and sync, reversibly.
const fakeClerk = { users: { getUser: async () => ({}) } };
const users = new UsersService(prisma, new AuditService(prisma), fakeClerk, {
  ADMIN_EMAILS: new Set(["ba5@x.io"]),
});
const dave = await mk(5);
const acct = await db.exchangeAccount.create({
  data: {
    userId: dave.id,
    exchange: "BINANCE",
    label: "Main",
    apiKeyHint: "abcd",
    credential: {
      create: {
        keyId: "v1",
        wrappedDataKey: Buffer.from("k"),
        apiKeyCipher: Buffer.from("a"),
        apiSecretCipher: Buffer.from("s"),
      },
    },
  },
});
// Not verified: listed email alone gives no admin rights.
assert.equal((await users.resolveByAuthProviderId("ba5")).role, "USER");
await admin.setSuspended(root.id, dave.id, true, "Chargeback");
assert.equal(await users.resolveByAuthProviderId("ba5"), null, "suspended users cannot sign in");
const { scheduleDueSyncs } = await import("../../worker/dist/scheduler.js");
const queued = [];
await scheduleDueSyncs(db, { addBulk: async (jobs) => queued.push(...jobs) }, 5);
assert.ok(!queued.some((j) => j.data.accountId === acct.id), "suspended users are not synced");
await admin.setSuspended(root.id, dave.id, false, "Resolved");
assert.ok(await users.resolveByAuthProviderId("ba5"), "restored");
await users.softDeleteByAuthProviderId("ba5");
assert.equal(
  await db.exchangeCredential.count({ where: { accountId: acct.id } }),
  0,
  "keys destroyed",
);
assert.equal(
  (await db.exchangeAccount.findUnique({ where: { id: acct.id } })).status,
  "DISCONNECTED",
);
const gone = await db.user.findUnique({ where: { id: dave.id } });
assert.match(gone.email, /^deleted\+/);
await assert.rejects(admin.setSuspended(root.id, dave.id, false, "undo"), /not found/i);
// A late "user.updated" webhook never restores personal data on a deleted account.
await users.upsertFromProvider(
  { authProviderId: "ba5", email: "ba5@x.io", name: "Dave", imageUrl: null, emailVerified: true },
  "webhook",
);
assert.match((await db.user.findUnique({ where: { id: dave.id } })).email, /^deleted\+/);
console.log(
  "✓ deletion destroys exchange keys; suspension blocks sign-in and sync; admin needs a verified email",
);

// Signed checkout claims: a customer may pay with any email when our server signed the account ID;
// a forged or missing claim still needs the email to match.
const erin = await mk(6);
const signedBilling = new BillingService(prisma, {
  ...env,
  PADDLE_API_KEY: "k",
  PADDLE_WEBHOOK_SECRET: "pdl_ntfset_signed",
});
signedBilling.paddle = new PaddleApi("k", "sandbox", fakeFetch);
const claim = (await signedBilling.billing(erin.id)).checkoutClaim;
assert.match(claim, /^[0-9a-f]{64}$/);
const esub = (over = {}) =>
  sub({
    id: "sub_e1",
    customer_id: "ctm_other_email",
    custom_data: { userId: erin.id, claim },
    ...over,
  });
assert.equal(
  await signedBilling.handleEvent(
    event(
      "subscription.created",
      esub({ custom_data: { userId: erin.id, claim: "0".repeat(64) } }),
      "2026-10-02T09:00:00Z",
    ),
  ),
  "IGNORED_CONFLICT",
  "forged claim and a different email: refused",
);
assert.equal(
  await signedBilling.handleEvent(event("subscription.created", esub(), "2026-10-02T10:00:00Z")),
  "APPLIED",
  "valid claim: linked even though the checkout email differs",
);
assert.equal((await subOf(erin)).planCode, "PRO");
// The payment itself is recorded against erin, with its amount, and shows in the admin list.
await signedBilling.handleEvent({
  event_id: "evt_txn_e1",
  event_type: "transaction.completed",
  occurred_at: new Date().toISOString(),
  data: {
    id: "txn_e1",
    subscription_id: "sub_e1",
    customer_id: "ctm_other_email",
    currency_code: "USD",
    details: { totals: { grand_total: "1500", earnings: "1375" } },
  },
});
const pay = await admin.payments(false, undefined);
const row = pay.items.find((r) => r.eventId === "evt_txn_e1");
assert.equal(row.userEmail, erin.email);
assert.deepEqual(row.amount, { currency: "USD", total: "15.00", earnings: "13.75" });
const usd = pay.revenue30d.find((r) => r.currency === "USD");
assert.equal(usd.total, "15.00");
assert.equal(usd.earnings, "13.75");
const problems = await admin.payments(true, undefined);
assert.ok(problems.items.length > 0 && problems.items.every((r) => r.problem));
assert.ok(problems.items.some((r) => r.outcome === "IGNORED_CONFLICT"));
console.log("✓ signed checkout claims; payments list with amounts, revenue and problems flagged");

await db.$disconnect();
console.log("All billing and admin integration checks passed");
