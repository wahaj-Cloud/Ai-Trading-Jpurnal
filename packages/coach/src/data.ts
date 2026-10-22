import { createHash } from "node:crypto";
import { isValidTimeZone, tradeRisk } from "@atc/analytics";
import type { Prisma, PrismaClient } from "@atc/db";
import {
  type PlanLimits,
  resolveLimits,
  subscriptionInForce,
  UNLIMITED,
  zoneAlignment,
} from "@atc/shared";
import type { CoachTrade } from "./types.js";

const s = (v: Prisma.Decimal | null) => (v === null ? null : v.toString());

export async function userTimeZone(db: PrismaClient, userId: string): Promise<string> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  return u && isValidTimeZone(u.timezone) ? u.timezone : "UTC";
}

export async function planLimits(db: PrismaClient, userId: string): Promise<PlanLimits> {
  const sub = await db.subscription.findUnique({
    where: { userId },
    select: {
      status: true,
      cryptoPaidUntil: true,
      paddleSubscriptionId: true,
      manualPlan: true,
      plan: { select: { code: true, limits: true } },
    },
  });
  // A lapsed paid subscription (or an expired crypto period) falls back to the Free plan's limits.
  const active = sub && subscriptionInForce(sub);
  if (active) return resolveLimits(sub.plan.code, sub.plan.limits);
  const free = await db.plan.findUnique({ where: { code: "FREE" }, select: { limits: true } });
  return resolveLimits("FREE", free?.limits);
}

/**
 * Adds an amount to a counter (used for AI spend in micro-dollars). One SQL statement, so
 * concurrent calls never lose an update.
 */
export async function addUsage(
  db: PrismaClient,
  userId: string,
  metric: string,
  period: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  const n = Math.min(Math.round(amount), 2_000_000_000);
  await db.$executeRaw`
    INSERT INTO usage_counters (user_id, metric, period, count)
    VALUES (${userId}::uuid, ${metric}, ${period}, ${n})
    ON CONFLICT (user_id, metric, period)
    DO UPDATE SET count = LEAST(usage_counters.count + ${n}, 2147483647)`;
}

/** Earliest date the user's plan shows history from (null = full history). */
export async function historyCutoff(
  db: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<Date | null> {
  const days = (await planLimits(db, userId)).historyDays;
  return days === UNLIMITED ? null : new Date(now.getTime() - days * 86_400_000);
}

/**
 * Atomically takes one unit of a metered allowance. Returns false when the limit is reached.
 * A single SQL statement, so two concurrent requests can never both take the last unit.
 */
export async function reserveUsage(
  db: Pick<PrismaClient, "$queryRaw">,
  userId: string,
  metric: string,
  period: string,
  limit: number,
): Promise<boolean> {
  if (limit === 0) return false;
  const cap = limit === UNLIMITED ? 2_147_483_647 : limit;
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO usage_counters (user_id, metric, period, count)
    VALUES (${userId}::uuid, ${metric}, ${period}, 1)
    ON CONFLICT (user_id, metric, period)
    DO UPDATE SET count = usage_counters.count + 1
    WHERE usage_counters.count < ${cap}
    RETURNING count`;
  return rows.length > 0;
}

/** Gives a unit back when the work it paid for failed. */
export async function releaseUsage(
  db: PrismaClient,
  userId: string,
  metric: string,
  period: string,
): Promise<void> {
  await db.usageCounter.updateMany({
    where: { userId, metric, period, count: { gt: 0 } },
    data: { count: { decrement: 1 } },
  });
}

export async function usageCount(
  db: PrismaClient,
  userId: string,
  metric: string,
  period: string,
): Promise<number> {
  const row = await db.usageCounter.findUnique({
    where: { userId_metric_period: { userId, metric, period } },
    select: { count: true },
  });
  return row?.count ?? 0;
}

const positionSelect = {
  id: true,
  sourceKey: true,
  accountId: true,
  symbol: true,
  direction: true,
  openedAt: true,
  closedAt: true,
  netPnl: true,
  fees: true,
  entryPrice: true,
  exitPrice: true,
  quantity: true,
  leverage: true,
  holdingSeconds: true,
  settleAsset: true,
  quoteAsset: true,
  setupAlertId: true,
  btcCorrAtEntry: true,
  entryZone: true,
} satisfies Prisma.PositionSelect;

type PositionRow = Prisma.PositionGetPayload<{ select: typeof positionSelect }>;
type JournalRow = Prisma.JournalEntryGetPayload<object>;

function zoneOf(direction: "LONG" | "SHORT", v: unknown): CoachTrade["zone"] {
  if (!v || typeof v !== "object") return null;
  if ("none" in v) return null;
  const e = v as { zones?: Array<{ side: "supply" | "demand"; tf: "1h" | "4h"; fresh: boolean }> };
  return Array.isArray(e.zones) ? zoneAlignment(direction, { zones: e.zones }) : null;
}

function toCoachTrade(
  p: PositionRow,
  j: JournalRow | undefined,
): CoachTrade & { accountId: string | null } {
  const netPnl = s(p.netPnl) ?? "0";
  const risk = tradeRisk({
    direction: p.direction,
    entryPrice: s(p.entryPrice),
    quantity: s(p.quantity),
    netPnl,
    stopPrice: s(j?.stopPrice ?? null),
    targetPrice: s(j?.targetPrice ?? null),
    inverse: p.settleAsset !== p.quoteAsset,
  });
  return {
    id: p.id,
    sourceKey: p.sourceKey,
    accountId: p.accountId,
    symbol: p.symbol,
    direction: p.direction,
    openedAt: p.openedAt,
    closedAt: p.closedAt ?? p.openedAt,
    netPnl,
    fees: s(p.fees),
    entryPrice: s(p.entryPrice),
    exitPrice: s(p.exitPrice),
    quantity: s(p.quantity),
    leverage: s(p.leverage),
    holdingSeconds: p.holdingSeconds,
    settleAsset: p.settleAsset,
    quoteAsset: p.quoteAsset,
    rMultiple: risk.rMultiple,
    plannedRewardRisk: risk.plannedRewardRisk,
    planned: p.setupAlertId !== null,
    zone: zoneOf(p.direction, p.entryZone),
    btcCorr: p.btcCorrAtEntry,
    journal: j
      ? {
          rating: j.rating,
          setup: j.setup,
          mistakes: j.mistakes,
          emotions: j.emotions,
          notes: j.notes,
          stopPrice: s(j.stopPrice),
          targetPrice: s(j.targetPrice),
        }
      : null,
  };
}

/** Closed trades (with journals) whose close falls in [from, to). */
export async function loadCoachTrades(
  db: PrismaClient,
  userId: string,
  range: { from?: Date | null; to?: Date | null },
): Promise<(CoachTrade & { accountId: string | null })[]> {
  const positions = await db.position.findMany({
    where: {
      userId,
      status: "CLOSED",
      netPnl: { not: null },
      closedAt: {
        not: null,
        ...(range.from ? { gte: range.from } : {}),
        ...(range.to ? { lt: range.to } : {}),
      },
    },
    select: positionSelect,
    orderBy: { closedAt: "asc" },
  });
  const journals = positions.length
    ? await db.journalEntry.findMany({
        where: { userId, positionKey: { in: positions.map((p) => p.sourceKey) } },
      })
    : [];
  const byKey = new Map(journals.map((j) => [j.positionKey, j]));
  return positions.map((p) => toCoachTrade(p, byKey.get(p.sourceKey)));
}

/** Fingerprint of everything a review is written from: a change makes the review stale. */
export function reviewInputHash(t: CoachTrade, extra = ""): string {
  const j = t.journal;
  return createHash("sha256")
    .update(
      JSON.stringify([
        t.netPnl,
        t.closedAt.toISOString(),
        t.entryPrice,
        t.exitPrice,
        t.quantity,
        j?.rating,
        j?.setup,
        j?.mistakes,
        j?.emotions,
        j?.notes,
        j?.stopPrice,
        j?.targetPrice,
        extra,
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}
