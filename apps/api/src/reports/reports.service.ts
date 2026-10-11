import { addDays, goalPeriod, localParts, startOfLocalDay, tradeRisk } from "@atc/analytics";
import {
  behaviourSummary,
  detectBehaviours,
  historyCutoff,
  loadCoachTrades,
  noteDto,
  userTimeZone,
} from "@atc/coach";
import type { Prisma } from "@atc/db";
import {
  EMOTIONS,
  type EmotionCode,
  type ExportQuery,
  MAX_EXPORT_ROWS,
  MISTAKES,
  type MistakeCode,
  type ReportDto,
  type ReportPeriod,
  USD_SETTLEMENT_ASSETS,
} from "@atc/shared";
import { Injectable } from "@nestjs/common";
import { AnalyticsService } from "../analytics/analytics.service.js";
import { toDto } from "../positions/positions.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

const DAY_MS = 86_400_000;
const monthName = new Intl.DateTimeFormat("en", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const dayName = new Intl.DateTimeFormat("en", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const utc = (day: string) => new Date(`${day}T00:00:00Z`);

export function periodBounds(
  period: ReportPeriod,
  date: string,
): { from: string; to: string; label: string } {
  switch (period) {
    case "day":
      return { from: date, to: date, label: dayName.format(utc(date)) };
    case "week": {
      const w = goalPeriod("WEEK", date);
      return { from: w.start, to: w.end, label: `Week of ${dayName.format(utc(w.start))}` };
    }
    case "month": {
      const m = goalPeriod("MONTH", date);
      return { from: m.start, to: m.end, label: monthName.format(utc(m.start)) };
    }
    case "year":
      return {
        from: `${date.slice(0, 4)}-01-01`,
        to: `${date.slice(0, 4)}-12-31`,
        label: date.slice(0, 4),
      };
  }
}

/** One exported trade row (all money as decimal strings). */
export interface ExportRow {
  closedAtUtc: string;
  closedLocal: string;
  openedAtUtc: string;
  exchange: string;
  account: string;
  symbol: string;
  direction: string;
  quantity: string;
  entryPrice: string;
  exitPrice: string;
  leverage: string;
  grossPnl: string;
  fees: string;
  funding: string;
  netPnl: string;
  settleAsset: string;
  holdingMinutes: string;
  rMultiple: string;
  setup: string;
  rating: string;
  emotions: string;
  mistakes: string;
  tags: string;
  notes: string;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  async timeZone(userId: string): Promise<string> {
    return userTimeZone(this.prisma.client, userId);
  }

  async report(
    userId: string,
    period: ReportPeriod,
    date?: string,
    now = new Date(),
  ): Promise<ReportDto> {
    const timeZone = await userTimeZone(this.prisma.client, userId);
    const today = localParts(now, timeZone).date;
    const { from, to, label } = periodBounds(period, date ?? today);
    const nextStart = addDays(to, 1);
    return this.build(userId, timeZone, now, {
      period,
      from,
      to,
      label,
      previous: addDays(from, -1),
      next: nextStart <= today ? nextStart : null,
    });
  }

  /** Summary for an arbitrary range (Excel exports). */
  async reportRange(
    userId: string,
    from: string,
    to: string,
    now = new Date(),
  ): Promise<ReportDto> {
    const timeZone = await userTimeZone(this.prisma.client, userId);
    return this.build(userId, timeZone, now, {
      period: "day",
      from,
      to,
      label: `${from} to ${to}`,
      previous: addDays(from, -1),
      next: null,
    });
  }

  private async build(
    userId: string,
    timeZone: string,
    now: Date,
    head: Pick<ReportDto, "period" | "from" | "to" | "label" | "previous" | "next">,
  ): Promise<ReportDto> {
    const db = this.prisma.client;
    const { from, to } = head;
    // The plan's history window applies to every part of the report, not only the statistics.
    const cutoff = await historyCutoff(db, userId, now);
    const periodStart = startOfLocalDay(from, timeZone);
    const start = cutoff && cutoff > periodStart ? cutoff : periodStart;
    const end = startOfLocalDay(addDays(to, 1), timeZone);
    const baselineFrom = new Date(start.getTime() - 30 * DAY_MS);
    const cutoffDay = cutoff ? localParts(cutoff, timeZone).date : null;

    const [analytics, trades, notes, ranked] = await Promise.all([
      this.analytics.report(userId, { range: "all", from, to }, now),
      loadCoachTrades(db, userId, {
        from: cutoff && cutoff > baselineFrom ? cutoff : baselineFrom,
        to: end,
      }),
      db.coachNote.findMany({
        where: {
          userId,
          period: { gte: cutoffDay && cutoffDay > from ? cutoffDay : from, lte: to },
        },
        orderBy: [{ period: "asc" }, { kind: "asc" }],
      }),
      db.position.findMany({
        where: {
          userId,
          status: "CLOSED",
          closedAt: { gte: start, lt: end },
          netPnl: { not: null },
          // Best and worst are ranked in USD; coin-settled results are not comparable.
          settleAsset: { in: [...USD_SETTLEMENT_ASSETS] },
        },
        include: { account: { select: { label: true } } },
        orderBy: { netPnl: "desc" },
      }),
    ]);
    const detection = detectBehaviours(trades, { timeZone, from: start, to: end });
    const winners = ranked.filter((p) => Number(p.netPnl) > 0);
    const losers = ranked.filter((p) => Number(p.netPnl) < 0).reverse();
    return {
      ...head,
      analytics,
      behaviour: behaviourSummary(detection, trades, { from, to }),
      notes: notes.map(noteDto),
      bestTrades: winners.slice(0, 5).map((p) => toDto(p)),
      worstTrades: losers.slice(0, 5).map((p) => toDto(p)),
    };
  }

  /** Closed trades with their journal, oldest first, for CSV / Excel export. */
  async exportRows(
    userId: string,
    q: ExportQuery,
  ): Promise<{ rows: ExportRow[]; truncated: boolean }> {
    const db = this.prisma.client;
    const timeZone = await userTimeZone(db, userId);
    const cutoff = await historyCutoff(db, userId);
    const fromDate = q.from ? startOfLocalDay(q.from, timeZone) : null;
    const earliest = cutoff && (!fromDate || fromDate < cutoff) ? cutoff : fromDate;
    const where: Prisma.PositionWhereInput = {
      userId,
      status: "CLOSED",
      closedAt: {
        not: null,
        ...(earliest ? { gte: earliest } : {}),
        ...(q.to ? { lt: startOfLocalDay(addDays(q.to, 1), timeZone) } : {}),
      },
    };
    const positions = await db.position.findMany({
      where,
      include: { account: { select: { label: true } } },
      orderBy: { closedAt: "asc" },
      take: MAX_EXPORT_ROWS + 1,
    });
    const truncated = positions.length > MAX_EXPORT_ROWS;
    const list = positions.slice(0, MAX_EXPORT_ROWS);
    const journals = new Map<string, Prisma.JournalEntryGetPayload<object>>();
    for (let i = 0; i < list.length; i += 5_000) {
      const chunk = await db.journalEntry.findMany({
        where: { userId, positionKey: { in: list.slice(i, i + 5_000).map((p) => p.sourceKey) } },
      });
      for (const j of chunk) journals.set(j.positionKey, j);
    }
    const local = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const s = (v: Prisma.Decimal | null) => (v === null ? "" : v.toString());
    const rows = list.map((p): ExportRow => {
      const j = journals.get(p.sourceKey);
      const r = tradeRisk({
        direction: p.direction,
        entryPrice: s(p.entryPrice) || null,
        quantity: s(p.quantity) || null,
        netPnl: s(p.netPnl) || null,
        stopPrice: j?.stopPrice?.toString() ?? null,
        targetPrice: null,
        inverse: p.settleAsset !== p.quoteAsset,
      });
      return {
        closedAtUtc: p.closedAt?.toISOString() ?? "",
        closedLocal: p.closedAt ? local.format(p.closedAt).replace(",", "") : "",
        openedAtUtc: p.openedAt.toISOString(),
        exchange: p.exchange,
        account: p.account?.label ?? (p.source === "CSV" ? "Imported" : ""),
        symbol: p.symbol,
        direction: p.direction,
        quantity: s(p.quantity),
        entryPrice: s(p.entryPrice),
        exitPrice: s(p.exitPrice),
        leverage: s(p.leverage),
        grossPnl: s(p.grossPnl),
        fees: s(p.fees),
        funding: s(p.funding),
        netPnl: s(p.netPnl),
        settleAsset: p.settleAsset,
        holdingMinutes: p.holdingSeconds === null ? "" : String(Math.round(p.holdingSeconds / 60)),
        rMultiple: r.rMultiple === null ? "" : String(r.rMultiple),
        setup: j?.setup ?? "",
        rating: j?.rating ? String(j.rating) : "",
        emotions: (j?.emotions ?? []).map((e) => EMOTIONS[e as EmotionCode] ?? e).join("; "),
        mistakes: (j?.mistakes ?? []).map((m) => MISTAKES[m as MistakeCode] ?? m).join("; "),
        tags: (j?.tags ?? []).join("; "),
        notes: j?.notes ?? "",
      };
    });
    return { rows, truncated };
  }
}
