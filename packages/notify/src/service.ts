import {
  addDays,
  computeAnalytics,
  evaluateGoal,
  evaluateRiskLimits,
  goalPeriod,
  localParts,
  startOfLocalDay,
} from "@atc/analytics";
import { loadCoachTrades, userTimeZone } from "@atc/coach";
import { Prisma, type PrismaClient } from "@atc/db";
import {
  emailWanted,
  type GoalDto,
  type GoalMetric,
  type NotificationDto,
  type NotificationKind,
  type RiskLimits,
  type RiskStatusDto,
  reminderHour,
  USD_SETTLEMENT_ASSETS,
} from "@atc/shared";
import { dec, str } from "@atc/trade-engine";
import { EmailError, type EmailSender, renderEmail } from "./email.js";

export interface NotifyDeps {
  db: PrismaClient;
  email: EmailSender;
  /** Public web address, for links in emails. */
  appUrl: string;
  now?: () => Date;
}

const nowOf = (d: NotifyDeps) => d.now?.() ?? new Date();
const MAX_EMAIL_ATTEMPTS = 5;

export interface NewNotification {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string | null;
  dedupeKey: string;
}

type NotificationRow = Prisma.NotificationGetPayload<object>;

export function notificationDto(n: NotificationRow): NotificationDto {
  return {
    id: n.id,
    kind: n.kind as NotificationKind,
    title: n.title,
    body: n.body,
    link: n.link,
    read: n.readAt !== null,
    createdAt: n.createdAt.toISOString(),
  };
}

/**
 * Creates a notification once per dedupe key and emails it when the user wants that kind by email.
 * Returns null when this event was already notified.
 */
export async function notify(
  deps: NotifyDeps,
  n: NewNotification,
): Promise<NotificationRow | null> {
  const { db } = deps;
  const settings = await db.userSettings.findUnique({
    where: { userId: n.userId },
    select: { notificationPrefs: true },
  });
  const wantsEmail = deps.email.enabled && emailWanted(settings?.notificationPrefs, n.kind);
  let row: NotificationRow;
  try {
    row = await db.notification.create({
      data: {
        userId: n.userId,
        kind: n.kind,
        title: n.title.slice(0, 160),
        body: n.body,
        link: n.link ?? null,
        dedupeKey: n.dedupeKey,
        emailStatus: wantsEmail ? "PENDING" : "NONE",
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return null; // already notified
    throw err;
  }
  if (wantsEmail) await deliver(deps, row);
  return row;
}

async function deliver(deps: NotifyDeps, row: NotificationRow): Promise<void> {
  const user = await deps.db.user.findUnique({
    where: { id: row.userId },
    select: { email: true, deletedAt: true, suspendedAt: true },
  });
  if (!user || user.deletedAt || user.suspendedAt) {
    await deps.db.notification.update({ where: { id: row.id }, data: { emailStatus: "NONE" } });
    return;
  }
  const message = renderEmail(row, deps.appUrl);
  try {
    await deps.email.send({ to: user.email, ...message });
    await deps.db.notification.update({
      where: { id: row.id },
      data: { emailStatus: "SENT", emailAttempts: { increment: 1 } },
    });
  } catch (err) {
    const retry =
      err instanceof EmailError && err.retryable && row.emailAttempts + 1 < MAX_EMAIL_ATTEMPTS;
    await deps.db.notification.update({
      where: { id: row.id },
      data: { emailStatus: retry ? "PENDING" : "FAILED", emailAttempts: { increment: 1 } },
    });
  }
}

/** Retries emails that failed temporarily (called on every scheduler tick). */
export async function deliverPendingEmails(deps: NotifyDeps): Promise<number> {
  const pending = await deps.db.notification.findMany({
    where: {
      emailStatus: "PENDING",
      createdAt: { gte: new Date(nowOf(deps).getTime() - 86_400_000) },
      // Only rows whose first attempt already happened (new ones are sent inline).
      emailAttempts: { gt: 0 },
    },
    take: 100,
  });
  for (const row of pending) await deliver(deps, row);
  return pending.length;
}

// ─── Risk ───

const d = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(2));

export async function getRiskLimits(db: PrismaClient, userId: string): Promise<RiskLimits> {
  const row = await db.riskLimit.findUnique({ where: { userId } });
  return {
    maxDailyLoss: d(row?.maxDailyLoss ?? null),
    maxTradesPerDay: row?.maxTradesPerDay ?? null,
    maxDrawdown: d(row?.maxDrawdown ?? null),
    dailyProfitTarget: d(row?.dailyProfitTarget ?? null),
  };
}

export async function riskStatus(
  db: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<RiskStatusDto> {
  const timeZone = await userTimeZone(db, userId);
  const limits = await getRiskLimits(db, userId);
  const today = localParts(now, timeZone).date;
  const hasLimits = Object.values(limits).some((v) => v !== null);
  if (!hasLimits) return { date: today, limits, rules: [] };
  // Runs after every sync, so it never loads the full history: today's trades for the daily
  // rules, and the drawdown from the equity peak computed in SQL (same rules as the analytics:
  // USD-settled closed trades in close order, peak starting at zero).
  const startToday = startOfLocalDay(today, timeZone);
  const trades = await loadCoachTrades(db, userId, { from: startToday });
  const report = computeAnalytics(
    trades.map((t) => ({ ...t, funding: null })),
    { timeZone, now, range: { from: null, to: null, timezone: timeZone } },
  );
  const [equity] = await db.$queryRaw<{ peak: unknown; last: unknown }[]>`
    SELECT GREATEST(COALESCE(MAX(cum), 0), 0) AS peak,
           COALESCE((ARRAY_AGG(cum ORDER BY closed_at DESC, id DESC))[1], 0) AS last
      FROM (SELECT id, closed_at,
                   SUM(net_pnl) OVER (ORDER BY closed_at, id ROWS UNBOUNDED PRECEDING) AS cum
              FROM positions
             WHERE user_id = ${userId}::uuid AND status = 'CLOSED' AND net_pnl IS NOT NULL
               AND closed_at IS NOT NULL AND settle_asset IN (${Prisma.join([...USD_SETTLEMENT_ASSETS])})) e`;
  const currentDrawdown = str(dec(String(equity?.peak ?? 0)).minus(String(equity?.last ?? 0)));
  // Today counts trades opened today too (the trade limit is about taking trades).
  const openedToday = await db.position.count({ where: { userId, openedAt: { gte: startToday } } });
  return {
    date: today,
    limits,
    rules: evaluateRiskLimits(
      limits,
      { pnl: report.today.pnl, trades: Math.max(openedToday, report.today.trades) },
      currentDrawdown,
    ),
  };
}

/** After each sync: warn once per rule per day when a limit is near, breached or a target hit. */
export async function checkRisk(deps: NotifyDeps, userId: string): Promise<number> {
  const status = await riskStatus(deps.db, userId, nowOf(deps));
  let sent = 0;
  for (const r of status.rules) {
    if (r.state === "OK") continue;
    const created = await notify(deps, {
      userId,
      kind: "RISK_WARNING",
      title:
        r.state === "BREACHED"
          ? `${r.label} reached`
          : r.state === "HIT"
            ? "Daily profit target reached"
            : `Close to your ${r.label.toLowerCase()}`,
      body: r.message,
      link: "/goals",
      dedupeKey: `risk:${r.rule}:${r.state}:${status.date}`,
    });
    if (created) sent++;
  }
  return sent;
}

// ─── Goals ───

/**
 * Goal progress for the current week/month, or (with `previous`) the final result of the period that
 * just ended.
 */
export async function goalsFor(
  db: PrismaClient,
  userId: string,
  now = new Date(),
  opts: { previous?: boolean } = {},
): Promise<GoalDto[]> {
  const goals = await db.goal.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  if (goals.length === 0) return [];
  const timeZone = await userTimeZone(db, userId);
  const today = localParts(now, timeZone).date;
  const out: GoalDto[] = [];
  const cache = new Map<string, Awaited<ReturnType<typeof figuresFor>>>();
  for (const g of goals) {
    const current = goalPeriod(g.period, today);
    const period = opts.previous ? goalPeriod(g.period, addDays(current.start, -1)) : current;
    // A goal set during this period has no result for the previous one.
    if (opts.previous && g.createdAt >= startOfLocalDay(current.start, timeZone)) continue;
    const key = `${period.start}`;
    let figures = cache.get(key);
    if (!figures) {
      figures = await figuresFor(db, userId, timeZone, period, now);
      cache.set(key, figures);
    }
    const start = startOfLocalDay(period.start, timeZone).getTime();
    const end = startOfLocalDay(addDays(period.end, 1), timeZone).getTime();
    const elapsed = opts.previous
      ? 1
      : Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
    out.push(
      evaluateGoal(
        { id: g.id, period: g.period, metric: g.metric as GoalMetric, target: g.target.toString() },
        figures,
        period,
        elapsed,
      ),
    );
  }
  return out;
}

async function figuresFor(
  db: PrismaClient,
  userId: string,
  timeZone: string,
  period: { start: string; end: string },
  now: Date,
) {
  const trades = await loadCoachTrades(db, userId, {
    from: startOfLocalDay(period.start, timeZone),
    to: startOfLocalDay(addDays(period.end, 1), timeZone),
  });
  const report = computeAnalytics(
    trades.map((t) => ({ ...t, funding: null })),
    { timeZone, now, range: { from: null, to: null, timezone: timeZone } },
  );
  return {
    netPnl: report.summary.netPnl,
    winRate: report.summary.winRate,
    profitFactor: report.summary.profitFactor,
    trades: report.summary.trades,
    reviewed: trades.filter((t) => t.journal !== null).length,
  };
}

// ─── Scheduled reminders and reports ───

/**
 * One pass over recently active traders, at each trader's own local time:
 *  - daily journal reminder at their chosen hour when today's trades are not all reviewed;
 *  - weekly report on Monday and monthly report on the 1st (after 08:00);
 *  - goal updates when a goal is met, missed or behind pace late in the period.
 * Every message has a dedupe key, so running this often is safe.
 */
export async function runScheduledNotifications(deps: NotifyDeps): Promise<number> {
  const { db } = deps;
  const now = nowOf(deps);
  const active = await db.position.groupBy({
    by: ["userId"],
    where: { closedAt: { gte: new Date(now.getTime() - 35 * 86_400_000) } },
  });
  if (active.length === 0) return 0;
  const users = await db.user.findMany({
    where: { id: { in: active.map((a) => a.userId) }, deletedAt: null, suspendedAt: null },
    select: { id: true, timezone: true, settings: { select: { notificationPrefs: true } } },
  });
  let sent = 0;
  for (const u of users) {
    const timeZone = await userTimeZone(db, u.id);
    const local = localParts(now, timeZone);
    const today = local.date;
    const created = (n: unknown) => {
      if (n) sent++;
    };

    // Daily reminder: today's closed trades that have no journal entry yet.
    if (local.hour >= reminderHour(u.settings?.notificationPrefs)) {
      const todays = await loadCoachTrades(db, u.id, { from: startOfLocalDay(today, timeZone) });
      const unreviewed = todays.filter((t) => t.journal === null).length;
      if (unreviewed > 0) {
        created(
          await notify(deps, {
            userId: u.id,
            kind: "DAILY_REMINDER",
            title: `${unreviewed} trade${unreviewed === 1 ? "" : "s"} to review today`,
            body: `You closed ${todays.length} trade${todays.length === 1 ? "" : "s"} today and ${unreviewed} ${unreviewed === 1 ? "has" : "have"} no review yet. Two minutes of notes now make tomorrow's coaching sharper.`,
            link: "/trades",
            dedupeKey: `daily:${today}`,
          }),
        );
      }
    }

    // Weekly (Monday) and monthly (1st) reports, from 08:00 local.
    if (local.hour >= 8) {
      if (local.weekday === 0)
        created(await periodReport(deps, u.id, timeZone, "WEEK", addDays(today, -7), today));
      if (today.endsWith("-01")) {
        const prevMonth = localParts(
          new Date(startOfLocalDay(today, timeZone).getTime() - 86_400_000),
          timeZone,
        ).month;
        created(await periodReport(deps, u.id, timeZone, "MONTH", `${prevMonth}-01`, today));
      }
    }

    // Goals: final result of the period that just ended (from 08:00 on its first days).
    if (local.hour >= 8) {
      for (const g of await goalsFor(db, u.id, now, { previous: true })) {
        const firstDays = addDays(g.periodEnd, g.period === "WEEK" ? 2 : 3) >= today;
        if (!firstDays || (g.state !== "MET" && g.state !== "FAILED")) continue;
        created(
          await notify(deps, {
            userId: u.id,
            kind: "GOAL_UPDATE",
            title: `${g.state === "MET" ? "Goal met" : "Goal missed"}: ${g.label.toLowerCase()} (${g.period === "WEEK" ? "last week" : "last month"})`,
            body: g.message.replace(
              g.period === "WEEK" ? "this week" : "this month",
              g.period === "WEEK" ? "last week" : "last month",
            ),
            link: "/goals",
            dedupeKey: `goal:${g.id}:${g.periodStart}:${g.state === "MET" ? "met" : "failed"}`,
          }),
        );
      }
    }

    // Goals in progress: profit goal reached, or behind late in the period.
    for (const g of await goalsFor(db, u.id, now)) {
      const daysLeft = Math.round(
        (startOfLocalDay(addDays(g.periodEnd, 1), timeZone).getTime() - now.getTime()) / 86_400_000,
      );
      const late = g.period === "WEEK" ? daysLeft <= 2 : daysLeft <= 7;
      if (
        g.state === "MET" ||
        (g.state === "ON_TRACK" && g.metric === "NET_PNL" && g.progress >= 1)
      ) {
        created(
          await notify(deps, {
            userId: u.id,
            kind: "GOAL_UPDATE",
            title: `Goal met: ${g.label.toLowerCase()}`,
            body: g.message,
            link: "/goals",
            dedupeKey: `goal:${g.id}:${g.periodStart}:met`,
          }),
        );
      } else if ((g.state === "BEHIND" && late) || g.state === "FAILED") {
        created(
          await notify(deps, {
            userId: u.id,
            kind: "GOAL_UPDATE",
            title:
              g.state === "FAILED"
                ? `Goal missed: ${g.label.toLowerCase()}`
                : `Behind on your ${g.label.toLowerCase()} goal`,
            body: g.message,
            link: "/goals",
            dedupeKey: `goal:${g.id}:${g.periodStart}:${g.state.toLowerCase()}`,
          }),
        );
      }
    }
  }
  await deliverPendingEmails(deps);
  return sent;
}

async function periodReport(
  deps: NotifyDeps,
  userId: string,
  timeZone: string,
  kind: "WEEK" | "MONTH",
  from: string,
  to: string,
) {
  const trades = await loadCoachTrades(deps.db, userId, {
    from: startOfLocalDay(from, timeZone),
    to: startOfLocalDay(to, timeZone),
  });
  if (trades.length === 0) return null;
  const r = computeAnalytics(
    trades.map((t) => ({ ...t, funding: null })),
    { timeZone, now: nowOf(deps), range: { from: null, to: null, timezone: timeZone } },
  ).summary;
  const money = (v: string | null) =>
    v === null ? "n/a" : `${Number(v) < 0 ? "−" : "+"}${Math.abs(Number(v)).toFixed(2)}`;
  const label = kind === "WEEK" ? `Week of ${from}` : `${from.slice(0, 7)}`;
  return notify(deps, {
    userId,
    kind: kind === "WEEK" ? "WEEKLY_REPORT" : "MONTHLY_REPORT",
    title: `${kind === "WEEK" ? "Weekly" : "Monthly"} report: ${money(r.netPnl)} USD`,
    body: `${label}: ${r.trades} trades, ${r.winRate === null ? "n/a" : `${Math.round(r.winRate * 100)}%`} won, net ${money(r.netPnl)}, profit factor ${r.profitFactor ?? "n/a"}.\n\nLargest win ${money(r.largestWin)}, largest loss ${money(r.largestLoss)}, fees ${r.fees}.`,
    link: `/reports?period=${kind === "WEEK" ? "week" : "month"}&date=${from}`,
    dedupeKey: `${kind === "WEEK" ? "weekly" : "monthly"}:${from}`,
  });
}
