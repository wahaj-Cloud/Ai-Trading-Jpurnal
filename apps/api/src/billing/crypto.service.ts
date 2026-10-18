import type { Prisma } from "@atc/db";
import {
  type CryptoBillingDto,
  type CryptoCheckoutInput,
  cryptoPriceUsd,
  nextCryptoPaidUntil,
} from "@atc/shared";
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  CRYPTO_STATUS,
  type NowPayment,
  type NowPaymentStatus,
  NowPaymentsApi,
} from "./nowpayments.js";

const LIVE = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);
const PENDING = ["CREATED", "WAITING", "CONFIRMING"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CryptoOutcome =
  | "APPLIED"
  | "RECORDED"
  | "DUPLICATE"
  | "IGNORED_UNKNOWN_ORDER"
  | "IGNORED_MISMATCH"
  | "NEEDS_REVIEW";

/**
 * Crypto payments through NOWPayments. Crypto cannot renew by itself, so each payment buys a fixed
 * period (30 or 365 days) of a plan; renewing adds to the time left. Card subscriptions (Paddle)
 * and crypto periods never run at the same time, so nobody is charged twice.
 */
@Injectable()
export class CryptoBillingService {
  private readonly logger = new Logger(CryptoBillingService.name);
  api: NowPaymentsApi | null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.api =
      env.NOWPAYMENTS_API_KEY && env.NOWPAYMENTS_IPN_SECRET && env.API_PUBLIC_URL
        ? new NowPaymentsApi(env.NOWPAYMENTS_API_KEY, env.NOWPAYMENTS_SANDBOX)
        : null;
  }

  async status(userId: string): Promise<CryptoBillingDto> {
    const [sub, pending] = await Promise.all([
      this.prisma.client.subscription.findUnique({
        where: { userId },
        select: { cryptoPaidUntil: true },
      }),
      this.prisma.client.cryptoPayment.findFirst({
        where: {
          userId,
          status: { in: PENDING },
          createdAt: { gte: new Date(Date.now() - 2 * 86_400_000) },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const until = sub?.cryptoPaidUntil;
    return {
      enabled: this.api !== null,
      paidUntil: until && until.getTime() > Date.now() ? until.toISOString() : null,
      prices: (["PRO", "PREMIUM"] as const).flatMap((plan) =>
        (["month", "year"] as const).map((interval) => ({
          plan,
          interval,
          usd: cryptoPriceUsd(plan, interval),
        })),
      ),
      // A checkout only opened (never paid into) is not shown as pending.
      pending:
        pending && pending.status !== "CREATED"
          ? {
              status: pending.status,
              plan: pending.planCode,
              interval: pending.interval,
              createdAt: pending.createdAt.toISOString(),
            }
          : null,
    };
  }

  /** Creates a NOWPayments invoice and returns its hosted payment page. */
  async checkout(userId: string, input: CryptoCheckoutInput): Promise<{ url: string }> {
    if (!this.api || !this.env.API_PUBLIC_URL)
      throw new ServiceUnavailableException("Crypto payments are not available yet.");
    const db = this.prisma.client;
    const sub = await db.subscription.findUnique({ where: { userId } });
    if (sub?.manualPlan) throw new BadRequestException("Your plan is managed by support.");
    if (sub?.paddleSubscriptionId && LIVE.has(sub.status)) {
      throw new BadRequestException(
        "You already pay by card. Cancel the card subscription first, or change plan there.",
      );
    }
    const price = cryptoPriceUsd(input.plan, input.interval);
    const row = await db.cryptoPayment.create({
      data: { userId, planCode: input.plan, interval: input.interval, amountUsd: price.toFixed(2) },
    });
    const web = this.env.WEB_ORIGINS[0] ?? "";
    let invoice: { id: string | number; invoice_url: string };
    try {
      invoice = await this.api.createInvoice({
        priceUsd: price,
        orderId: row.id,
        description: `WickMentor ${input.plan === "PRO" ? "Pro" : "Premium"}, ${input.interval === "year" ? "1 year" : "1 month"}`,
        ipnUrl: `${this.env.API_PUBLIC_URL.replace(/\/$/, "")}/v1/webhooks/nowpayments`,
        successUrl: `${web}/billing?crypto=paid`,
        cancelUrl: `${web}/billing?crypto=cancelled`,
      });
    } catch (err) {
      await db.cryptoPayment.update({ where: { id: row.id }, data: { status: "FAILED" } });
      this.logger.error({ msg: "nowpayments invoice failed", err: String(err) });
      throw new ServiceUnavailableException(
        "The crypto payment page could not be opened. Try again.",
      );
    }
    // Only ever send the customer to NOWPayments' own pages.
    const url = new URL(invoice.invoice_url);
    if (url.protocol !== "https:" || !/(^|\.)nowpayments\.io$/.test(url.hostname)) {
      throw new ServiceUnavailableException("Unexpected payment page.");
    }
    await db.cryptoPayment.update({
      where: { id: row.id },
      data: { invoiceId: String(invoice.id) },
    });
    return { url: url.toString() };
  }

  /**
   * One verified payment notification. The notification is only a trigger: the payment is read
   * back from NOWPayments' API and its order, amount and currency must match what we created.
   * Idempotent per payment and status; the plan is extended once, when the funds have arrived.
   */
  async handleIpn(body: NowPayment): Promise<CryptoOutcome> {
    if (!this.api) throw new ServiceUnavailableException("Crypto payments are not configured.");
    const paymentId = String(body.payment_id ?? "");
    if (!/^\d{1,30}$/.test(paymentId)) return "IGNORED_UNKNOWN_ORDER";
    const p = await this.api.payment(paymentId);
    const orderId = p.order_id ?? body.order_id ?? "";
    if (!UUID.test(orderId)) return "IGNORED_UNKNOWN_ORDER";
    const status = CRYPTO_STATUS[p.payment_status as NowPaymentStatus];
    if (!status) return "IGNORED_MISMATCH";
    const eventId = `np:${paymentId}:${p.payment_status}`;
    const db = this.prisma.client;

    return db.$transaction(
      async (tx) => {
        const inserted = await tx.billingEvent.createMany({
          data: [
            {
              eventId,
              type: `crypto.${p.payment_status}`,
              occurredAt: new Date(),
              payload: { data: p } as unknown as Prisma.InputJsonValue,
              outcome: "PROCESSING",
            },
          ],
          skipDuplicates: true,
        });
        if (inserted.count === 0) return "DUPLICATE";
        const done = async (outcome: CryptoOutcome, userId: string | null) => {
          await tx.billingEvent.update({ where: { eventId }, data: { outcome, userId } });
          if (outcome !== "APPLIED" && outcome !== "RECORDED")
            this.logger.warn({ msg: "crypto payment not applied", outcome, paymentId, orderId });
          return outcome;
        };

        const rows = await tx.$queryRaw<{ id: string; user_id: string; status: string }[]>`
          SELECT id, user_id, status FROM crypto_payments WHERE id = ${orderId}::uuid FOR UPDATE`;
        const row = rows[0];
        if (!row) return done("IGNORED_UNKNOWN_ORDER", null);
        const payment = await tx.cryptoPayment.findUniqueOrThrow({ where: { id: row.id } });
        const amountOk =
          String(p.price_currency ?? "").toLowerCase() === "usd" &&
          Math.abs(Number(p.price_amount) - Number(payment.amountUsd)) < 0.005;
        if (!amountOk) return done("IGNORED_MISMATCH", row.user_id);

        // Once paid, a payment never goes back to a pending state; refunds are recorded for review.
        if (payment.status === "PAID" && status !== "REFUNDED")
          return done("RECORDED", row.user_id);
        if (status !== "PAID") {
          await tx.cryptoPayment.update({
            where: { id: row.id },
            data: {
              status,
              paymentId,
              payCurrency: p.pay_currency ?? payment.payCurrency,
            },
          });
          return done(
            status === "REFUNDED" || status === "PARTIAL" ? "NEEDS_REVIEW" : "RECORDED",
            row.user_id,
          );
        }

        // Paid: extend the plan, with the subscription row locked.
        const subs = await tx.$queryRaw<
          {
            plan_code: string;
            status: string;
            paddle_subscription_id: string | null;
            manual_plan: boolean;
            crypto_paid_until: Date | null;
          }[]
        >`SELECT plan_code::text AS plan_code, status::text AS status, paddle_subscription_id,
                 manual_plan, crypto_paid_until
            FROM subscriptions WHERE user_id = ${row.user_id}::uuid FOR UPDATE`;
        const sub = subs[0];
        const now = new Date();
        await tx.cryptoPayment.update({
          where: { id: row.id },
          data: { status: "PAID", paymentId, payCurrency: p.pay_currency ?? null, paidAt: now },
        });
        // Paid while a card subscription or a support-granted plan is in force: keep the money on
        // record and let an admin refund or apply it; never stack two billing methods.
        if (!sub || sub.manual_plan || (sub.paddle_subscription_id && LIVE.has(sub.status))) {
          return done("NEEDS_REVIEW", row.user_id);
        }
        const until = nextCryptoPaidUntil({
          now,
          currentPlan: sub.plan_code,
          currentUntil: sub.crypto_paid_until,
          plan: payment.planCode as "PRO" | "PREMIUM",
          interval: payment.interval as "month" | "year",
        });
        await tx.subscription.update({
          where: { userId: row.user_id },
          data: {
            planCode: payment.planCode,
            status: "ACTIVE",
            cryptoPaidUntil: until,
            currentPeriodEnd: until,
            cancelAtPeriodEnd: true,
            paddleSubscriptionId: null,
            paddlePriceId: null,
          },
        });
        await tx.cryptoPayment.update({ where: { id: row.id }, data: { periodEnd: until } });
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: "billing.crypto_paid",
            entity: "subscription",
            entityId: row.user_id,
            metadata: {
              paymentId,
              plan: payment.planCode,
              interval: payment.interval,
              amountUsd: payment.amountUsd.toString(),
              payCurrency: p.pay_currency ?? null,
              until: until.toISOString(),
            },
          },
        });
        return done("APPLIED", row.user_id);
      },
      { timeout: 15_000 },
    );
  }
}
