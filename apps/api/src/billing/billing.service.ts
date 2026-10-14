import { planLimits } from "@atc/coach";
import type { Prisma } from "@atc/db";
import { type BillingDto, type PlanOfferDto, type PublicPlanDto, resolveLimits } from "@atc/shared";
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { PaddleApi, type PaddleEvent, type PaddleSubscription, STATUS } from "./paddle.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);

export type EventOutcome =
  | "APPLIED"
  | "DUPLICATE"
  | "IGNORED_STALE"
  | "IGNORED_UNKNOWN_USER"
  | "IGNORED_CONFLICT"
  | "IGNORED_MANUAL"
  | "IGNORED_UNKNOWN_PRICE"
  | "IGNORED_TYPE";

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  readonly paddle: PaddleApi | null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.paddle = env.PADDLE_API_KEY
      ? new PaddleApi(env.PADDLE_API_KEY, env.PADDLE_ENVIRONMENT)
      : null;
  }

  private planForPrice(priceId: string | undefined): "PRO" | "PREMIUM" | null {
    return this.env.PADDLE_PRICES.find((p) => p.priceId === priceId)?.plan ?? null;
  }

  /** Public plans for the landing page: names, list prices and limits only. */
  async publicPlans(): Promise<PublicPlanDto[]> {
    const plans = await this.prisma.client.plan.findMany({
      where: { isPublic: true, code: { not: "ENTERPRISE" } },
      orderBy: { sortOrder: "asc" },
    });
    return plans.map((p) => ({
      code: p.code,
      name: p.name,
      priceUsd: p.priceUsd === null ? null : Number(p.priceUsd),
      limits: resolveLimits(p.code, p.limits),
    }));
  }

  async billing(userId: string): Promise<BillingDto> {
    const db = this.prisma.client;
    const [user, plans] = await Promise.all([
      db.user.findUniqueOrThrow({
        where: { id: userId },
        include: { subscription: { include: { plan: true } } },
      }),
      db.plan.findMany({ where: { isPublic: true }, orderBy: { sortOrder: "asc" } }),
    ]);
    const sub = user.subscription;
    const live = sub && LIVE.has(sub.status);
    const effective = live ? sub.plan : (plans.find((p) => p.code === "FREE") ?? sub?.plan);
    const offers: PlanOfferDto[] = plans.map((p) => ({
      code: p.code,
      name: p.name,
      limits: resolveLimits(p.code, p.limits),
      prices: this.env.PADDLE_PRICES.filter((x) => x.plan === p.code).map(
        ({ interval, priceId }) => ({ interval, priceId }),
      ),
    }));
    return {
      plan: { code: effective?.code ?? "FREE", name: effective?.name ?? "Free" },
      status: sub?.status ?? "ACTIVE",
      currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      hasBillingAccount: Boolean(sub?.paddleCustomerId),
      hasOnlineSubscription: Boolean(sub?.paddleSubscriptionId && live && !sub.manualPlan),
      currentPriceId: live ? (sub?.paddlePriceId ?? null) : null,
      manualPlan: sub?.manualPlan ?? false,
      offers,
      checkoutEnabled: this.env.PADDLE_PRICES.length > 0,
      email: user.email,
      userId: user.id,
    };
  }

  async portal(userId: string): Promise<{ url: string }> {
    const sub = await this.prisma.client.subscription.findUnique({ where: { userId } });
    if (!sub?.paddleCustomerId) throw new BadRequestException("You have no billing account yet.");
    if (!this.paddle) throw new ServiceUnavailableException("Billing is not configured.");
    return { url: await this.paddle.portalUrl(sub.paddleCustomerId, sub.paddleSubscriptionId) };
  }

  /**
   * Applies one verified Paddle event inside one transaction:
   * - idempotent: the event ID is stored first; a concurrent duplicate inserts nothing and stops;
   * - order-safe: the subscription row is locked and events older than the last applied one for the
   *   same Paddle subscription are ignored;
   * - safe linking: an event is matched by its Paddle subscription ID; a subscription not linked yet
   *   is linked only to the user named in the checkout, whose email must match the paying customer,
   *   and never over another live subscription or a plan granted by support.
   */
  async handleEvent(event: PaddleEvent): Promise<EventOutcome> {
    const db = this.prisma.client;
    if (
      await db.billingEvent.findUnique({ where: { eventId: event.event_id }, select: { id: true } })
    ) {
      return "DUPLICATE";
    }
    const isSubscription = event.event_type.startsWith("subscription.");
    const s = event.data as PaddleSubscription;
    // Network lookup before the transaction: only needed to link a subscription we do not know yet.
    let customerEmail: string | null = null;
    if (isSubscription && this.paddle && s?.id) {
      const linked = await db.subscription.findUnique({
        where: { paddleSubscriptionId: s.id },
        select: { id: true },
      });
      if (!linked) customerEmail = (await this.paddle.customer(s.customer_id)).email.toLowerCase();
    }

    return db.$transaction(
      async (tx) => {
        const inserted = await tx.billingEvent.createMany({
          data: [
            {
              eventId: event.event_id,
              type: event.event_type,
              occurredAt: new Date(event.occurred_at),
              payload: event as unknown as Prisma.InputJsonValue,
              outcome: "PROCESSING",
            },
          ],
          skipDuplicates: true,
        });
        if (inserted.count === 0) return "DUPLICATE"; // a concurrent delivery owns this event
        const { outcome, userId } = isSubscription
          ? await this.applySubscription(
              tx,
              s,
              new Date(event.occurred_at),
              event.event_type,
              customerEmail,
            )
          : { outcome: "IGNORED_TYPE" as const, userId: null };
        await tx.billingEvent.update({
          where: { eventId: event.event_id },
          data: { outcome, userId },
        });
        if (outcome !== "APPLIED" && outcome !== "IGNORED_TYPE") {
          this.logger.warn({ msg: "paddle event not applied", outcome, userId, sub: s?.id });
        }
        return outcome;
      },
      { timeout: 15_000 },
    );
  }

  private async applySubscription(
    tx: Prisma.TransactionClient,
    s: PaddleSubscription,
    occurredAt: Date,
    eventType: string,
    customerEmail: string | null,
  ): Promise<{ outcome: EventOutcome; userId: string | null }> {
    const claimed =
      s.custom_data?.userId && UUID.test(s.custom_data.userId) ? s.custom_data.userId : null;
    const byId = await tx.subscription.findUnique({
      where: { paddleSubscriptionId: s.id },
      select: { userId: true },
    });
    const userId = byId?.userId ?? claimed;
    if (!userId) return { outcome: "IGNORED_UNKNOWN_USER", userId: null };
    // A checkout naming a different user than the one this subscription belongs to is never trusted.
    if (byId && claimed && claimed !== byId.userId) return { outcome: "IGNORED_CONFLICT", userId };

    // Lock the row: concurrent events for this user are applied one after another.
    const rows = await tx.$queryRaw<
      {
        paddle_subscription_id: string | null;
        paddle_event_at: Date | null;
        status: string;
        manual_plan: boolean;
        plan_code: string;
        email: string;
      }[]
    >`SELECT s.paddle_subscription_id, s.paddle_event_at, s.status::text AS status, s.manual_plan,
             s.plan_code::text AS plan_code, u.email
        FROM subscriptions s JOIN users u ON u.id = s.user_id
       WHERE s.user_id = ${userId}::uuid AND u.deleted_at IS NULL
       FOR UPDATE OF s`;
    const current = rows[0];
    if (!current) return { outcome: "IGNORED_UNKNOWN_USER", userId: null };
    if (current.manual_plan) return { outcome: "IGNORED_MANUAL", userId };

    // Older than the last event applied for this user (including the cancellation of a previous
    // subscription): a late delivery must never undo newer state or revive a canceled subscription.
    if (current.paddle_event_at && occurredAt <= current.paddle_event_at) {
      return { outcome: "IGNORED_STALE", userId };
    }
    if (current.paddle_subscription_id !== s.id) {
      // Never replace another live subscription (a second checkout, or late events of an old one).
      if (current.paddle_subscription_id && LIVE.has(current.status)) {
        return { outcome: "IGNORED_CONFLICT", userId };
      }
      // Linking: the paying customer's email must be this user's.
      if (this.paddle && customerEmail !== current.email.toLowerCase()) {
        return { outcome: "IGNORED_CONFLICT", userId };
      }
      // Events of a subscription that is not (or no longer) linked cannot revive it once canceled.
      if (STATUS[s.status] === "CANCELED") return { outcome: "IGNORED_STALE", userId };
    }

    const priceId = s.items?.[0]?.price?.id;
    const plan = this.planForPrice(priceId);
    const status = STATUS[s.status];
    if (!status) return { outcome: "IGNORED_TYPE", userId };
    if (!plan && status !== "CANCELED") return { outcome: "IGNORED_UNKNOWN_PRICE", userId };
    const canceled = status === "CANCELED";

    await tx.subscription.update({
      where: { userId },
      data: {
        planCode: canceled ? "FREE" : (plan ?? (current.plan_code as "FREE")),
        status: canceled ? "ACTIVE" : status,
        paddleSubscriptionId: canceled ? null : s.id,
        paddleCustomerId: s.customer_id,
        paddlePriceId: canceled ? null : (priceId ?? null),
        currentPeriodEnd:
          !canceled && s.current_billing_period?.ends_at
            ? new Date(s.current_billing_period.ends_at)
            : null,
        cancelAtPeriodEnd: !canceled && s.scheduled_change?.action === "cancel",
        paddleEventAt: occurredAt,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: null,
        action: "billing.subscription_updated",
        entity: "subscription",
        entityId: userId,
        metadata: {
          event: eventType,
          status: s.status,
          plan: plan ?? "FREE",
          subscriptionId: s.id,
        },
      },
    });
    return { outcome: "APPLIED", userId };
  }

  /**
   * Moves a live subscription to another price (upgrade, downgrade or interval change) through
   * Paddle's API, prorated. A new checkout would create a second subscription and bill twice.
   * The plan changes when Paddle confirms with a subscription.updated webhook.
   */
  async changePlan(userId: string, priceId: string): Promise<{ ok: true }> {
    if (!this.paddle) throw new ServiceUnavailableException("Billing is not configured.");
    if (!this.planForPrice(priceId)) throw new BadRequestException("Unknown price.");
    const sub = await this.prisma.client.subscription.findUnique({ where: { userId } });
    if (!sub?.paddleSubscriptionId || !LIVE.has(sub.status) || sub.manualPlan) {
      throw new BadRequestException("You have no active online subscription to change.");
    }
    if (sub.paddlePriceId === priceId)
      throw new BadRequestException("You are already on this plan.");
    await this.paddle.changePrice(sub.paddleSubscriptionId, priceId);
    await this.prisma.client.auditLog.create({
      data: {
        actorId: userId,
        action: "billing.plan_change_requested",
        entity: "subscription",
        entityId: userId,
        metadata: { from: sub.paddlePriceId, to: priceId },
      },
    });
    return { ok: true };
  }

  /** Limits currently in force for the user (used by admin views). */
  limits(userId: string) {
    return planLimits(this.prisma.client, userId);
  }
}
