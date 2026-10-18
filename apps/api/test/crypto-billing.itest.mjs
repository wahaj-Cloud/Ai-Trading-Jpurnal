// Integration test: crypto payments (NOWPayments) — invoices, signed notifications re-checked
// against the API, plan periods, renewals and expiry. Run after build.
import "reflect-metadata";
import assert from "node:assert/strict";
import { planLimits } from "@atc/coach";
import { createPrismaClient } from "@atc/db";
import { MemorySender, runCryptoRenewals } from "@atc/notify";
import { AdminService } from "../dist/admin/admin.service.js";
import { AuditService } from "../dist/audit/audit.service.js";
import { BillingService } from "../dist/billing/billing.service.js";
import { CryptoBillingService } from "../dist/billing/crypto.service.js";
import {
  NowPaymentsApi,
  signNowPaymentsBody,
  verifyNowPaymentsSignature,
} from "../dist/billing/nowpayments.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const prisma = { client: db };
const DAY = 86_400_000;
const SECRET = "ipn_secret_test";

// 1. Signatures: keys sorted at every level; any change breaks it.
const body = {
  payment_status: "finished",
  payment_id: 5,
  fee: { serviceFee: 1, currency: "usdt" },
};
const raw = Buffer.from(JSON.stringify(body));
const sig = signNowPaymentsBody(
  { fee: { currency: "usdt", serviceFee: 1 }, payment_id: 5, payment_status: "finished" },
  SECRET,
);
assert.equal(verifyNowPaymentsSignature(raw, sig, SECRET), true);
assert.equal(
  verifyNowPaymentsSignature(Buffer.from(JSON.stringify({ ...body, payment_id: 6 })), sig, SECRET),
  false,
);
assert.equal(verifyNowPaymentsSignature(raw, sig, "other"), false);
assert.equal(verifyNowPaymentsSignature(raw, undefined, SECRET), false);
console.log(
  "✓ NOWPayments signatures: sorted keys verified; tampering, wrong secret and missing header rejected",
);

await db.$executeRawUnsafe("TRUNCATE users CASCADE");
await db.billingEvent.deleteMany({
  where: { OR: [{ type: { startsWith: "crypto." } }, { eventId: "evt_cr_1" }] },
});
const mk = (n) =>
  db.user.create({
    data: {
      authProviderId: `cr${n}`,
      email: `cr${n}@x.io`,
      timezone: "UTC",
      emailVerified: true,
      subscription: { create: { planCode: "FREE" } },
      settings: { create: {} },
    },
  });
const ana = await mk(1);
const ben = await mk(2);
const root = await db.user.create({
  data: { authProviderId: "cr-admin", email: "cra@x.io", role: "ADMIN", emailVerified: true },
});

// Fake NOWPayments: invoices, and the payment record the API returns on look-up.
const payments = new Map();
let invoiceSeq = 100;
const fakeFetch = async (url, init = {}) => {
  const u = new URL(String(url));
  assert.equal(init.headers["x-api-key"], "np_key");
  if (u.pathname === "/v1/invoice" && init.method === "POST") {
    const b = JSON.parse(init.body);
    assert.equal(b.price_currency, "usd");
    assert.equal(b.ipn_callback_url, "https://api.example.com/v1/webhooks/nowpayments");
    invoiceSeq += 1;
    return Response.json({
      id: invoiceSeq,
      invoice_url: `https://nowpayments.io/payment/?iid=${invoiceSeq}`,
    });
  }
  const m = u.pathname.match(/^\/v1\/payment\/(\d+)$/);
  if (m && payments.has(m[1])) return Response.json(payments.get(m[1]));
  return new Response("not found", { status: 404 });
};
const env = {
  NOWPAYMENTS_API_KEY: "np_key",
  NOWPAYMENTS_IPN_SECRET: SECRET,
  NOWPAYMENTS_SANDBOX: false,
  API_PUBLIC_URL: "https://api.example.com",
  WEB_ORIGINS: ["https://app.example.com"],
  PADDLE_ENVIRONMENT: "sandbox",
  PADDLE_PRICES: [],
};
const crypto = new CryptoBillingService(prisma, env);
crypto.api = new NowPaymentsApi("np_key", false, fakeFetch);
const expectHttp = async (p, status) => {
  try {
    await p;
    assert.fail("expected error");
  } catch (e) {
    assert.equal(e.getStatus?.(), status, e.message);
  }
};

// 2. Checkout: a pending order and NOWPayments' hosted page.
const { url } = await crypto.checkout(ana.id, { plan: "PRO", interval: "month" });
assert.match(url, /^https:\/\/nowpayments\.io\/payment\/\?iid=101$/);
const order = await db.cryptoPayment.findFirstOrThrow({ where: { userId: ana.id } });
assert.equal(order.amountUsd.toString(), "15");
assert.equal(order.invoiceId, "101");
const pay = (id, status, over = {}) => {
  payments.set(String(id), {
    payment_id: id,
    invoice_id: 101,
    order_id: order.id,
    payment_status: status,
    price_amount: 15,
    price_currency: "usd",
    pay_currency: "usdttrc20",
    actually_paid: 15.02,
    ...over,
  });
  return crypto.handleIpn({ payment_id: id, payment_status: status });
};

// 3. Waiting: recorded, shown as pending, no plan yet.
assert.equal(await pay(7001, "waiting"), "RECORDED");
assert.equal((await crypto.status(ana.id)).pending?.status, "WAITING");
assert.equal((await planLimits(db, ana.id)).exchangeAccounts, 1);

// 4. A notification whose amount does not match the order never grants anything.
assert.equal(await pay(7001, "finished", { price_amount: 1 }), "IGNORED_MISMATCH");
assert.equal((await planLimits(db, ana.id)).exchangeAccounts, 1);

// 5. Finished: Pro for 30 days; a repeat is a no-op.
payments.delete("7001");
assert.equal(await pay(7002, "finished"), "APPLIED");
let sub = await db.subscription.findUniqueOrThrow({ where: { userId: ana.id } });
assert.equal(sub.planCode, "PRO");
const days = (d) => Math.round((d.getTime() - Date.now()) / DAY);
assert.equal(days(sub.cryptoPaidUntil), 30);
assert.equal((await planLimits(db, ana.id)).exchangeAccounts, 2);
assert.equal(await crypto.handleIpn({ payment_id: 7002, payment_status: "finished" }), "DUPLICATE");
const status = await crypto.status(ana.id);
assert.equal(status.pending, null);
assert.ok(status.paidUntil);
console.log(
  "✓ crypto checkout: pending shown, mismatched amounts refused, paid once, plan granted for 30 days",
);

// 6. Renewing early for a year adds to the time left.
await crypto.checkout(ana.id, { plan: "PRO", interval: "year" });
const yearly = await db.cryptoPayment.findFirstOrThrow({
  where: { userId: ana.id, interval: "year" },
});
payments.set("7003", {
  payment_id: 7003,
  order_id: yearly.id,
  payment_status: "finished",
  price_amount: 150,
  price_currency: "usd",
  pay_currency: "btc",
});
assert.equal(await crypto.handleIpn({ payment_id: 7003, payment_status: "finished" }), "APPLIED");
sub = await db.subscription.findUniqueOrThrow({ where: { userId: ana.id } });
assert.equal(days(sub.cryptoPaidUntil), 395);
console.log("✓ renewing early adds a year to the 30 days left");

// 7. Never two billing methods: card subscribers cannot open crypto checkout, and a payment that
// lands anyway is held for review.
await db.subscription.update({
  where: { userId: ben.id },
  data: { planCode: "PRO", paddleSubscriptionId: "sub_ben", status: "ACTIVE" },
});
await expectHttp(crypto.checkout(ben.id, { plan: "PREMIUM", interval: "month" }), 400);
const benOrder = await db.cryptoPayment.create({
  data: { userId: ben.id, planCode: "PREMIUM", interval: "month", amountUsd: "25.00" },
});
payments.set("7004", {
  payment_id: 7004,
  order_id: benOrder.id,
  payment_status: "finished",
  price_amount: 25,
  price_currency: "usd",
});
assert.equal(
  await crypto.handleIpn({ payment_id: 7004, payment_status: "finished" }),
  "NEEDS_REVIEW",
);
assert.equal(
  (await db.subscription.findUniqueOrThrow({ where: { userId: ben.id } })).planCode,
  "PRO",
);
console.log("✓ card subscribers are not double-billed; a stray crypto payment is held for review");

// 8. Paddle card checkout later replaces the crypto period.
const billing = new BillingService(prisma, {
  ...env,
  PADDLE_PRICES: [{ plan: "PREMIUM", interval: "month", priceId: "pri_prem_m" }],
});
assert.equal(
  await billing.handleEvent({
    event_id: "evt_cr_1",
    event_type: "subscription.created",
    occurred_at: new Date().toISOString(),
    data: {
      id: "sub_ana",
      status: "active",
      customer_id: "ctm_ana",
      items: [{ price: { id: "pri_prem_m" } }],
      custom_data: { userId: ana.id },
    },
  }),
  "APPLIED",
);
sub = await db.subscription.findUniqueOrThrow({ where: { userId: ana.id } });
assert.equal(sub.planCode, "PREMIUM");
assert.equal(sub.cryptoPaidUntil, null);
console.log("✓ moving to a card subscription replaces the crypto period");

// 9. Expiry: limits drop at once; the job moves the plan to Free and tells the user; reminders once.
const cleo = await mk(3);
await db.subscription.update({
  where: { userId: cleo.id },
  data: { planCode: "PRO", cryptoPaidUntil: new Date(Date.now() + 5 * DAY) },
});
const dan = await mk(4);
await db.subscription.update({
  where: { userId: dan.id },
  data: { planCode: "PREMIUM", cryptoPaidUntil: new Date(Date.now() - 60_000) },
});
assert.equal(
  (await planLimits(db, dan.id)).exchangeAccounts,
  1,
  "expired period: Free limits at once",
);
const email = new MemorySender();
const deps = { db, email, appUrl: "https://app.example.com" };
const r1 = await runCryptoRenewals(deps);
assert.deepEqual(r1, { reminded: 1, ended: 1 });
assert.deepEqual(await runCryptoRenewals(deps), { reminded: 0, ended: 0 }, "each notice once");
assert.equal(
  (await db.subscription.findUniqueOrThrow({ where: { userId: dan.id } })).planCode,
  "FREE",
);
const notes = await db.notification.findMany({ where: { userId: { in: [cleo.id, dan.id] } } });
assert.ok(notes.some((n) => n.userId === cleo.id && /ends in a week/.test(n.title)));
assert.ok(notes.some((n) => n.userId === dan.id && /has ended/.test(n.title)));
console.log(
  "✓ expiry: Free limits immediately, plan moved and user told; renewal reminders sent once",
);

// 10. Admin: crypto revenue kept apart from card revenue; held payments flagged.
const admin = new AdminService(prisma, new AuditService(prisma));
const p = await admin.payments(false, undefined);
const cryptoUsd = p.revenue30d.find((r) => r.method === "crypto" && r.currency === "USD");
assert.equal(cryptoUsd.total, "190.00"); // 15 + 150 + 25
assert.equal(cryptoUsd.payments, 3);
const problems = await admin.payments(true, undefined);
assert.ok(problems.items.some((r) => r.outcome === "NEEDS_REVIEW"));
assert.ok(problems.items.some((r) => r.outcome === "IGNORED_MISMATCH"));
void root;
console.log("✓ admin payments: crypto revenue by method, problems flagged");

await db.$disconnect();
console.log("All crypto billing integration checks passed");
