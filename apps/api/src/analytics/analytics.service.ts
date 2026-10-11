import {
  type AnalyticsTrade,
  computeAnalytics,
  isValidTimeZone,
  localParts,
  resolveRange,
  startOfLocalDay,
  tradeRisk,
} from "@atc/analytics";
import { historyCutoff } from "@atc/coach";
import type { Prisma } from "@atc/db";
import type { AnalyticsDto, AnalyticsQuery } from "@atc/shared";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

const s = (v: Prisma.Decimal | null) => (v === null ? null : v.toString());

/**
 * Performance analytics over closed trades. Computed on request from the trades table (indexed by
 * user and close time): always consistent with the Trades page, with no second copy to keep in sync.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(userId: string, q: AnalyticsQuery, now = new Date()): Promise<AnalyticsDto> {
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const timeZone = isValidTimeZone(user.timezone) ? user.timezone : "UTC";
    const resolved = resolveRange(q, timeZone, now);
    // The plan's history window (e.g. 30 days on Free) bounds every report.
    const cutoff = await historyCutoff(this.prisma.client, userId, now);
    const limited = cutoff !== null && (resolved.from === null || resolved.from < cutoff);
    const range = limited ? { ...resolved, from: cutoff } : resolved;

    const filter = { exchange: q.exchange, accountId: q.accountId };
    const report = computeAnalytics(await this.trades(userId, range, filter), {
      timeZone,
      now,
      range: { from: range.fromDay, to: range.toDay, timezone: timeZone },
    });

    // "Today" and "this month" always mean the current day and month, whatever period is shown.
    const monthStart = startOfLocalDay(`${localParts(now, timeZone).month}-01`, timeZone);
    const coversMonth = (!range.from || range.from <= monthStart) && !range.to;
    if (!coversMonth) {
      const current = computeAnalytics(
        await this.trades(userId, { from: monthStart, to: null }, filter),
        { timeZone, now, range: report.range },
      );
      report.today = current.today;
      report.thisMonth = current.thisMonth;
    }
    return { ...report, historyLimitedFrom: limited && cutoff ? cutoff.toISOString() : null };
  }

  private async trades(
    userId: string,
    range: { from: Date | null; to: Date | null },
    q: { exchange?: AnalyticsQuery["exchange"]; accountId?: string },
  ): Promise<AnalyticsTrade[]> {
    const positions = await this.prisma.client.position.findMany({
      where: {
        userId,
        status: "CLOSED",
        netPnl: { not: null },
        closedAt: {
          not: null,
          ...(range.from ? { gte: range.from } : {}),
          ...(range.to ? { lt: range.to } : {}),
        },
        ...(q.exchange ? { exchange: q.exchange } : {}),
        ...(q.accountId ? { accountId: q.accountId } : {}),
      },
      select: {
        id: true,
        sourceKey: true,
        symbol: true,
        direction: true,
        openedAt: true,
        closedAt: true,
        entryPrice: true,
        quantity: true,
        netPnl: true,
        fees: true,
        funding: true,
        holdingSeconds: true,
        quoteAsset: true,
        settleAsset: true,
      },
    });

    const journals = positions.length
      ? await this.prisma.client.journalEntry.findMany({
          where: { userId, positionKey: { in: positions.map((p) => p.sourceKey) } },
          select: {
            positionKey: true,
            setup: true,
            tags: true,
            mistakes: true,
            emotions: true,
            stopPrice: true,
          },
        })
      : [];
    const journalByKey = new Map(journals.map((j) => [j.positionKey, j]));

    return positions.map((p) => {
      const j = journalByKey.get(p.sourceKey);
      const netPnl = s(p.netPnl) ?? "0";
      return {
        id: p.id,
        symbol: p.symbol,
        direction: p.direction,
        openedAt: p.openedAt,
        closedAt: p.closedAt ?? p.openedAt,
        netPnl,
        fees: s(p.fees),
        funding: s(p.funding),
        holdingSeconds: p.holdingSeconds,
        settleAsset: p.settleAsset,
        riskAmount: j?.stopPrice
          ? tradeRisk({
              direction: p.direction,
              entryPrice: s(p.entryPrice),
              quantity: s(p.quantity),
              netPnl,
              stopPrice: j.stopPrice.toString(),
              targetPrice: null,
              inverse: p.settleAsset !== p.quoteAsset,
            }).riskAmount
          : null,
        setup: j?.setup ?? null,
        tags: j?.tags ?? [],
        mistakes: j?.mistakes ?? [],
        emotions: j?.emotions ?? [],
      };
    });
  }
}
