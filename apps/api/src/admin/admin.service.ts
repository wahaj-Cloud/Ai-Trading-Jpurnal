import { localParts } from "@atc/analytics";
import type { Prisma } from "@atc/db";
import type {
  AdminAuditRowDto,
  AdminLogsPage,
  AdminOverviewDto,
  AdminPlanChange,
  AdminSyncRowDto,
  AdminUserDetailDto,
  AdminUserRowDto,
  AdminUsersPage,
  AnnouncementDto,
  AnnouncementInput,
} from "@atc/shared";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
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
  };
}

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
