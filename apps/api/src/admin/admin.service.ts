import { localParts } from "@atc/analytics";
import type { Prisma } from "@atc/db";
import {
  type AdminAuditRowDto,
  type AdminCostsDto,
  type AdminLogsPage,
  type AdminOverviewDto,
  type AdminPaymentsDto,
  type AdminPlanChange,
  type AdminPlanCostRow,
  type AdminPlanUpdate,
  type AdminSyncRowDto,
  type AdminUserCostRow,
  type AdminUserDetailDto,
  type AdminUserRowDto,
  type AdminUsersPage,
  AI_COST_METRIC,
  type AnnouncementDto,
  type AnnouncementInput,
  calibrate,
  PAYMENT_PROBLEM_OUTCOMES,
  type ReadoutRecord,
  resolveLimits,
  type ScalpCalibrationDto,
  UNLIMITED,
} from "@atc/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { transactionAmount } from "../billing/paddle.js";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";

const PAGE = 50;
const DAY = 86_400_000;

type UserWithSub = Prisma.UserGetPayload<{
  include: { subscription: true; _count: { select: { exchangeAccounts: true } } };
}>;

function row(u: UserWithSub): AdminUserRowDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    plan: u.subscription?.planCode ?? "FREE",
    status: u.subscription?.status ?? "ACTIVE",
    manualPlan: u.subscription?.manualPlan ?? false,
    exchanges: u._count.exchangeAccounts,
    createdAt: u.createdAt.toISOString(),
    suspended: u.suspendedAt !== null,
    foundingMember: u.foundingMember,
  };
}

/** Paddle's standard fee, used to estimate payment costs in the margin view. */
const PAYMENT_PCT = 0.05;
const PAYMENT_FIXED_USD = 0.5;
/** Gross-margin target the plans are sized for. */
const TARGET_MARGIN = 0.75;
const LIVE_STATUSES = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);
const round2 = (n: number) => Math.round(n * 100) / 100;

const announcementDto = (a: Prisma.AnnouncementGetPayload<object>): AnnouncementDto => ({
  id: a.id,
  title: a.title,
  body: a.body,
  level: a.level,
  startsAt: a.startsAt.toISOString(),
  endsAt: a.endsAt?.toISOString() ?? null,
});

@Injectable()
export class AdminService {
  /** Recomputed at most every 10 minutes: it reads up to 8 days of records. */
  private calibration: { days: number; at: number; dto: ScalpCalibrationDto } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async scalpCalibration(days: number, now = Date.now()): Promise<ScalpCalibrationDto> {
    const c = this.calibration;
    if (c && c.days === days && now - c.at < 10 * 60_000) return c.dto;
    // Every 5th minute is plenty for the spread and keeps the read small.
    const rows = await this.prisma.client.$queryRaw<Array<{ at: Date; data: unknown }>>`
      SELECT at, data FROM scalp_readouts
       WHERE at >= ${new Date(now - days * 86_400_000)}
         AND EXTRACT(MINUTE FROM at)::int % 5 = 0
       ORDER BY at`;
    const dto = calibrate(
      rows.map((r) => ({ at: r.at.getTime(), data: r.data as Record<string, ReadoutRecord> })),
    );
    this.calibration = { days, at: now, dto };
    return dto;
  }

  /**
   * What each plan and the most expensive users cost this month against what they pay: AI spend
   * (tracked per call), MetaApi terminals for Exness accounts, and payment fees. Revenue uses
   * each plan's list price, so it is an estimate (discounts and yearly billing are not applied).
   */
  async costs(month: string): Promise<AdminCostsDto> {
    const db = this.prisma.client;
    const [plans, users, spend, brokers] = await Promise.all([
      db.plan.findMany({ orderBy: { sortOrder: "asc" } }),
      db.user.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          email: true,
          foundingMember: true,
          subscription: { select: { planCode: true, status: true } },
        },
      }),
      db.usageCounter.findMany({
        where: { metric: AI_COST_METRIC, period: month },
        select: { userId: true, count: true },
      }),
      db.exchangeAccount.groupBy({
        by: ["userId"],
        where: { exchange: "EXNESS", status: { not: "DISCONNECTED" } },
        _count: { _all: true },
      }),
    ]);
    const perAccount = this.env.METAAPI_ACCOUNT_USD;
    const spendOf = new Map(spend.map((r) => [r.userId, r.count / 1_000_000]));
    const brokersOf = new Map(brokers.map((b) => [b.userId, b._count._all]));
    const planOf = new Map(plans.map((p) => [p.code, p]));
    const priceOf = (code: string) => {
      const v = planOf.get(code as AdminPlanCostRow["code"])?.priceUsd;
      return v === null || v === undefined ? null : Number(v);
    };
    const fee = (price: number | null) => (price ? price * PAYMENT_PCT + PAYMENT_FIXED_USD : 0);
    const margin = (revenue: number, cost: number) =>
      revenue > 0 ? round2(((revenue - cost) / revenue) * 10_000) / 10_000 : null;

    const rows: AdminUserCostRow[] = users.map((u) => {
      const code = (
        u.subscription && LIVE_STATUSES.has(u.subscription.status)
          ? u.subscription.planCode
          : "FREE"
      ) as AdminPlanCostRow["code"];
      const limits = resolveLimits(code, planOf.get(code)?.limits);
      const ai = spendOf.get(u.id) ?? 0;
      const b = brokersOf.get(u.id) ?? 0;
      const price = priceOf(code);
      return {
        id: u.id,
        email: u.email,
        plan: code,
        foundingMember: u.foundingMember,
        aiCostUsd: round2(ai * 100) / 100,
        aiBudgetUsd: limits.aiBudgetUsd,
        budgetUsedPct:
          limits.aiBudgetUsd === UNLIMITED
            ? null
            : limits.aiBudgetUsd > 0
              ? ai / limits.aiBudgetUsd
              : ai > 0
                ? 1
                : 0,
        brokerAccounts: b,
        marginPct: margin(price ?? 0, ai + b * perAccount + fee(price)),
      };
    });

    const planRows: AdminPlanCostRow[] = plans.map((p) => {
      const mine = rows.filter((r) => r.plan === p.code);
      const price = priceOf(p.code);
      const aiCost = mine.reduce((s, r) => s + (spendOf.get(r.id) ?? 0), 0);
      const brokerAccounts = mine.reduce((s, r) => s + r.brokerAccounts, 0);
      const revenue = (price ?? 0) * mine.length;
      const fees = mine.length * fee(price);
      const metaapi = brokerAccounts * perAccount;
      return {
        code: p.code,
        name: p.name,
        priceUsd: price,
        limits: resolveLimits(p.code, p.limits),
        users: mine.length,
        revenueUsd: round2(revenue),
        aiCostUsd: round2(aiCost),
        brokerAccounts,
        metaapiCostUsd: round2(metaapi),
        paymentFeesUsd: round2(fees),
        marginPct: margin(revenue, aiCost + metaapi + fees),
      };
    });
    const sum = (k: keyof AdminPlanCostRow) => planRows.reduce((s, r) => s + (r[k] as number), 0);
    const revenue = sum("revenueUsd");
    const costs = sum("aiCostUsd") + sum("metaapiCostUsd") + sum("paymentFeesUsd");
    return {
      month,
      assumptions: {
        metaapiUsdPerAccount: perAccount,
        paymentPct: PAYMENT_PCT,
        paymentFixedUsd: PAYMENT_FIXED_USD,
      },
      plans: planRows,
      totals: {
        users: rows.length,
        revenueUsd: round2(revenue),
        aiCostUsd: round2(sum("aiCostUsd")),
        metaapiCostUsd: round2(sum("metaapiCostUsd")),
        paymentFeesUsd: round2(sum("paymentFeesUsd")),
        grossProfitUsd: round2(revenue - costs),
        marginPct: margin(revenue, costs),
      },
      topUsers: rows
        .filter((r) => r.aiCostUsd > 0 || r.brokerAccounts > 0)
        .sort(
          (a, b) =>
            b.aiCostUsd +
            b.brokerAccounts * perAccount -
            (a.aiCostUsd + a.brokerAccounts * perAccount),
        )
        .slice(0, 25),
      targetMarginPct: TARGET_MARGIN,
    };
  }

  /** Price and limits of one plan. Takes effect for every user on it immediately. */
  async updatePlan(actorId: string, code: AdminPlanCostRow["code"], input: AdminPlanUpdate) {
    const plan = await this.prisma.client.plan.findUnique({ where: { code } });
    if (!plan) throw new NotFoundException("Plan not found");
    const { priceUsd, ...limits } = input;
    await this.prisma.client.plan.update({
      where: { code },
      data: { priceUsd, limits },
    });
    await this.audit.record({
      actorId,
      action: "admin.plan_updated",
      entity: "plan",
      entityId: null,
      metadata: {
        code,
        before: { priceUsd: plan.priceUsd?.toString() ?? null, limits: plan.limits },
        after: input,
      },
    });
  }

  async setFoundingMember(
    actorId: string,
    userId: string,
    foundingMember: boolean,
  ): Promise<AdminUserDetailDto> {
    const res = await this.prisma.client.user.updateMany({
      where: { id: userId, deletedAt: null },
      data: { foundingMember },
    });
    if (res.count === 0) throw new NotFoundException("User not found");
    await this.audit.record({
      actorId,
      action: foundingMember ? "admin.founding_member_added" : "admin.founding_member_removed",
      entity: "user",
      entityId: userId,
    });
    return this.user(userId);
  }

  async overview(now = new Date()): Promise<AdminOverviewDto> {
    const db = this.prisma.client;
    const month = localParts(now, "UTC").month;
    const since30 = new Date(now.getTime() - 30 * DAY);
    const [
      total,
      new7d,
      new30d,
      suspended,
      subs,
      exchanges,
      runs24h,
      failed24h,
      failing,
      trades,
      trades24h,
      usage,
      tokens,
      signups,
    ] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { createdAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
      db.user.count({ where: { createdAt: { gte: since30 } } }),
      db.user.count({ where: { suspendedAt: { not: null } } }),
      db.subscription.groupBy({ by: ["planCode", "status"], _count: { _all: true } }),
      db.exchangeAccount.groupBy({ by: ["exchange", "status"], _count: { _all: true } }),
      db.syncRun.count({ where: { startedAt: { gte: new Date(now.getTime() - DAY) } } }),
      db.syncRun.count({
        where: { startedAt: { gte: new Date(now.getTime() - DAY) }, status: "FAILED" },
      }),
      db.exchangeAccount.count({
        where: { OR: [{ syncFailures: { gt: 0 } }, { status: "INVALID" }] },
      }),
      db.position.count(),
      db.position.count({ where: { createdAt: { gte: new Date(now.getTime() - DAY) } } }),
      db.usageCounter.groupBy({ by: ["metric"], where: { period: month }, _sum: { count: true } }),
      Promise.all([
        db.tradeReview.aggregate({
          where: { generatedAt: { gte: new Date(`${month}-01T00:00:00Z`) } },
          _sum: { inputTokens: true, outputTokens: true },
        }),
        db.coachNote.aggregate({
          where: { createdAt: { gte: new Date(`${month}-01T00:00:00Z`) } },
          _sum: { inputTokens: true, outputTokens: true },
        }),
        db.coachMessage.aggregate({
          where: { createdAt: { gte: new Date(`${month}-01T00:00:00Z`) } },
          _sum: { inputTokens: true, outputTokens: true },
        }),
      ]),
      db.$queryRaw<{ day: string; count: bigint }[]>`
          SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, count(*) AS count
          FROM users WHERE created_at >= ${since30}
          GROUP BY 1 ORDER BY 1`,
    ]);
    const used = (m: string) => usage.find((u) => u.metric === m)?._sum.count ?? 0;
    return {
      users: { total, new7d, new30d, suspended },
      subscriptions: subs.map((s) => ({
        plan: s.planCode,
        status: s.status,
        count: s._count._all,
      })),
      exchanges: exchanges.map((e) => ({
        exchange: e.exchange,
        status: e.status,
        count: e._count._all,
      })),
      sync: { runs24h, failed24h, failingAccounts: failing },
      trades: { total: trades, last24h: trades24h },
      ai: {
        reviewsThisMonth: used("ai_trade_review"),
        notesThisMonth: used("ai_coach_note"),
        messagesThisMonth: used("coach_message"),
        tokensThisMonth: tokens.reduce(
          (s, t) => s + (t._sum.inputTokens ?? 0) + (t._sum.outputTokens ?? 0),
          0,
        ),
      },
      signups: signups.map((s) => ({ date: s.day, count: Number(s.count) })),
    };
  }

  async users(q: string | undefined, cursor: string | undefined): Promise<AdminUsersPage> {
    const where: Prisma.UserWhereInput = {
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(cursor ? { id: { lt: cursor } } : {}),
    };
    const rows = await this.prisma.client.user.findMany({
      where,
      include: { subscription: true, _count: { select: { exchangeAccounts: true } } },
      orderBy: { id: "desc" },
      take: PAGE + 1,
    });
    const page = rows.slice(0, PAGE);
    return {
      items: page.map(row),
      nextCursor: rows.length > PAGE ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async user(id: string): Promise<AdminUserDetailDto> {
    const db = this.prisma.client;
    const u = await db.user.findUnique({
      where: { id },
      include: {
        subscription: true,
        _count: { select: { exchangeAccounts: true } },
        exchangeAccounts: { orderBy: { createdAt: "asc" } },
        usageCounters: { orderBy: { period: "desc" }, take: 20 },
      },
    });
    if (!u) throw new NotFoundException("User not found");
    const [trades, audit] = await Promise.all([
      db.position.count({ where: { userId: id } }),
      this.auditRows({ OR: [{ actorId: id }, { entityId: id }] }, undefined, 20),
    ]);
    return {
      ...row(u),
      timezone: u.timezone,
      currentPeriodEnd: u.subscription?.currentPeriodEnd?.toISOString() ?? null,
      paddleSubscriptionId: u.subscription?.paddleSubscriptionId ?? null,
      accounts: u.exchangeAccounts.map((a) => ({
        id: a.id,
        exchange: a.exchange,
        label: a.label,
        status: a.status,
        lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
        lastError: a.lastError,
        syncFailures: a.syncFailures,
      })),
      usage: u.usageCounters.map((c) => ({ metric: c.metric, period: c.period, count: c.count })),
      trades,
      recentAudit: audit.items,
    };
  }

  /** Grants a plan by hand (support, partners, Enterprise). Billing events stop overriding it. */
  async changePlan(
    actorId: string,
    userId: string,
    input: AdminPlanChange,
  ): Promise<AdminUserDetailDto> {
    const sub = await this.prisma.client.subscription.findUnique({ where: { userId } });
    if (!sub) throw new NotFoundException("User not found");
    // Any manual grant would freeze an online subscription (later cancellations would be ignored).
    if (sub.paddleSubscriptionId) {
      throw new BadRequestException(
        "This user pays online. Change or cancel the subscription in Paddle; manual plans are for unpaid accounts.",
      );
    }
    await this.prisma.client.subscription.update({
      where: { userId },
      data: { planCode: input.planCode, status: "ACTIVE", manualPlan: input.planCode !== "FREE" },
    });
    await this.audit.record({
      actorId,
      action: "admin.plan_changed",
      entity: "subscription",
      entityId: userId,
      metadata: { from: sub.planCode, to: input.planCode, reason: input.reason },
    });
    return this.user(userId);
  }

  async setSuspended(
    actorId: string,
    userId: string,
    suspended: boolean,
    reason: string,
  ): Promise<AdminUserDetailDto> {
    if (actorId === userId) throw new BadRequestException("You cannot suspend your own account.");
    // Deleted accounts are final; suspension is a separate, reversible flag.
    const res = await this.prisma.client.user.updateMany({
      where: { id: userId, deletedAt: null },
      data: { suspendedAt: suspended ? new Date() : null },
    });
    if (res.count === 0) throw new NotFoundException("User not found");
    await this.audit.record({
      actorId,
      action: suspended ? "admin.user_suspended" : "admin.user_restored",
      entity: "user",
      entityId: userId,
      metadata: { reason },
    });
    return this.user(userId);
  }

  private async auditRows(
    where: Prisma.AuditLogWhereInput,
    cursor: string | undefined,
    take = PAGE,
  ): Promise<AdminLogsPage<AdminAuditRowDto>> {
    const rows = await this.prisma.client.auditLog.findMany({
      where: { ...where, ...(cursor ? { id: { lt: cursor } } : {}) },
      include: { actor: { select: { email: true } } },
      orderBy: { id: "desc" },
      take: take + 1,
    });
    const page = rows.slice(0, take);
    return {
      items: page.map((a) => ({
        id: a.id,
        action: a.action,
        entity: a.entity,
        entityId: a.entityId,
        actorEmail: a.actor?.email ?? null,
        ip: a.ip,
        metadata: a.metadata,
        createdAt: a.createdAt.toISOString(),
      })),
      nextCursor: rows.length > take ? (page.at(-1)?.id ?? null) : null,
    };
  }

  auditLog(action: string | undefined, cursor: string | undefined) {
    return this.auditRows(action ? { action: { startsWith: action } } : {}, cursor);
  }

  async syncRuns(
    failedOnly: boolean,
    cursor: string | undefined,
  ): Promise<AdminLogsPage<AdminSyncRowDto>> {
    const rows = await this.prisma.client.syncRun.findMany({
      where: {
        ...(failedOnly ? { status: "FAILED" } : {}),
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      include: { account: { select: { exchange: true, user: { select: { email: true } } } } },
      orderBy: { id: "desc" },
      take: PAGE + 1,
    });
    const page = rows.slice(0, PAGE);
    return {
      items: page.map((r) => ({
        id: r.id,
        accountId: r.accountId,
        exchange: r.account.exchange,
        userEmail: r.account.user.email,
        kind: r.kind,
        status: r.status,
        errorCode: r.errorCode,
        errorMessage: r.errorMessage,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
      })),
      nextCursor: rows.length > PAGE ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * Payments as Paddle reported them, newest first, with problems flagged: a payment event that did
   * not update the customer's plan (unknown user, conflict, unknown price) must be fixed by hand.
   */
  async payments(
    problemsOnly: boolean,
    cursor: string | undefined,
    now = new Date(),
  ): Promise<AdminPaymentsDto> {
    const db = this.prisma.client;
    const problem = (outcome: string, type: string) =>
      (PAYMENT_PROBLEM_OUTCOMES as readonly string[]).includes(outcome) ||
      type === "transaction.payment_failed";
    const problemWhere = {
      OR: [
        { outcome: { in: [...PAYMENT_PROBLEM_OUTCOMES] } },
        { type: "transaction.payment_failed" },
      ],
    };
    const since30 = new Date(now.getTime() - 30 * DAY);
    const [rows, completed, problems30d] = await Promise.all([
      db.billingEvent.findMany({
        where: { ...(problemsOnly ? problemWhere : {}), ...(cursor ? { id: { lt: cursor } } : {}) },
        orderBy: { id: "desc" },
        take: PAGE + 1,
      }),
      db.billingEvent.findMany({
        where: {
          type: { in: ["transaction.completed", "crypto.finished"] },
          occurredAt: { gte: since30 },
          // Notifications we could not verify against the order are not counted as money in.
          outcome: { notIn: ["IGNORED_MISMATCH", "IGNORED_UNKNOWN_ORDER"] },
        },
        select: { type: true, payload: true },
        take: 10_000,
      }),
      db.billingEvent.count({ where: { ...problemWhere, occurredAt: { gte: since30 } } }),
    ]);
    const page = rows.slice(0, PAGE);
    const ids = [...new Set(page.map((r) => r.userId).filter((v): v is string => v !== null))];
    const users = ids.length
      ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } })
      : [];
    const emailOf = new Map(users.map((u) => [u.id, u.email]));

    // Revenue per currency, summed in minor units so no rounding creeps in.
    // Card (Paddle) and crypto (NOWPayments) are kept apart: their fees differ.
    const revenue = new Map<
      string,
      {
        method: "card" | "crypto";
        currency: string;
        payments: number;
        total: bigint;
        earnings: bigint | null;
      }
    >();
    for (const r of completed) {
      const p = r.payload as { data?: Record<string, unknown> };
      const a = transactionAmount({ event_type: r.type, data: p?.data });
      if (!a) continue;
      const toMinor = (v: string) => BigInt(v.replace(".", ""));
      const method = r.type.startsWith("crypto.") ? ("crypto" as const) : ("card" as const);
      const key = `${method}:${a.currency}`;
      const cur = revenue.get(key) ?? {
        method,
        currency: a.currency,
        payments: 0,
        total: 0n,
        earnings: 0n,
      };
      cur.payments += 1;
      cur.total += toMinor(a.total);
      cur.earnings =
        cur.earnings === null || a.earnings === null ? null : cur.earnings + toMinor(a.earnings);
      revenue.set(key, cur);
    }
    const major = (v: bigint, currency: string) =>
      transactionAmount({
        event_type: "transaction.x",
        data: { currency_code: currency, details: { totals: { grand_total: v.toString() } } },
      })?.total ?? v.toString();

    return {
      items: page.map((r) => {
        const p = r.payload as { data?: Record<string, unknown> };
        const d = (p?.data ?? {}) as {
          id?: string;
          customer_id?: string;
          subscription_id?: string;
        };
        const isSub = r.type.startsWith("subscription.");
        const crypto = r.type.startsWith("crypto.");
        return {
          id: r.id,
          eventId: r.eventId,
          type: r.type,
          outcome: r.outcome,
          occurredAt: r.occurredAt.toISOString(),
          userEmail: r.userId ? (emailOf.get(r.userId) ?? null) : null,
          customerId: crypto ? null : (d.customer_id ?? null),
          subscriptionId: crypto
            ? `NOWPayments ${String((d as { payment_id?: unknown }).payment_id ?? "")}`
            : ((isSub ? d.id : d.subscription_id) ?? null),
          amount: transactionAmount({ event_type: r.type, data: p?.data }),
          problem: problem(r.outcome, r.type),
        };
      }),
      nextCursor: rows.length > PAGE ? (page.at(-1)?.id ?? null) : null,
      revenue30d: [...revenue.values()].map((v) => ({
        method: v.method,
        currency: v.currency,
        payments: v.payments,
        total: major(v.total, v.currency),
        earnings: v.earnings === null ? null : major(v.earnings, v.currency),
      })),
      problems30d,
    };
  }

  async announcements(): Promise<AnnouncementDto[]> {
    const rows = await this.prisma.client.announcement.findMany({
      orderBy: { startsAt: "desc" },
      take: 100,
    });
    return rows.map(announcementDto);
  }

  async createAnnouncement(actorId: string, input: AnnouncementInput): Promise<AnnouncementDto> {
    const a = await this.prisma.client.announcement.create({
      data: {
        title: input.title,
        body: input.body,
        level: input.level,
        startsAt: input.startsAt ? new Date(input.startsAt) : new Date(),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        createdBy: actorId,
      },
    });
    await this.audit.record({
      actorId,
      action: "admin.announcement_created",
      entity: "announcement",
      entityId: a.id,
    });
    return announcementDto(a);
  }

  async endAnnouncement(actorId: string, id: string): Promise<void> {
    const res = await this.prisma.client.announcement.updateMany({
      where: { id },
      data: { endsAt: new Date() },
    });
    if (res.count === 0) throw new NotFoundException("Announcement not found");
    await this.audit.record({
      actorId,
      action: "admin.announcement_ended",
      entity: "announcement",
      entityId: id,
    });
  }

  /** Announcements shown to users right now. */
  async activeAnnouncements(now = new Date()): Promise<AnnouncementDto[]> {
    const rows = await this.prisma.client.announcement.findMany({
      where: { startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      orderBy: { startsAt: "desc" },
      take: 3,
    });
    return rows.map(announcementDto);
  }
}
