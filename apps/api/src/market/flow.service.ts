import { planLimits } from "@atc/coach";
import { Prisma, snapshotsOf } from "@atc/db";
import {
  DESK_FREE_SYMBOL,
  DESK_NAMES,
  DESK_SYMBOLS,
  type DeskSymbol,
  deskKey,
  FLOW_EXCHANGES,
  FLOW_FREE_SYMBOLS,
  FLOW_STATUS_KEY,
  FLOW_WINDOW_MS,
  type FlowExchange,
  type FlowFeedPage,
  type FlowFeedQuery,
  type FlowStatus,
  type FlowSummaryDto,
  type FlowSummaryQuery,
  type LiquidationDto,
  type MarketBiasDto,
  type MarketDeskDto,
  type WhaleTradeDto,
} from "@atc/shared";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

const PAGE = 50;
const BUCKETS = 12;
const LIVE_STATUS_MS = 90_000;

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/**
 * Market Flow read side: summaries and feeds of whale trades and liquidations collected by the
 * worker, and the trend bias table for the dashboard. All figures come straight from stored rows.
 */
@Injectable()
export class FlowService {
  constructor(private readonly prisma: PrismaService) {}

  private async allFlow(userId: string): Promise<boolean> {
    return (await planLimits(this.prisma.client, userId)).marketDesk === 1;
  }

  private async status(): Promise<FlowStatus | null> {
    const row = await this.prisma.client.marketSnapshot.findUnique({
      where: { key: FLOW_STATUS_KEY },
    });
    return (row?.data as unknown as FlowStatus | undefined) ?? null;
  }

  async summary(userId: string, q: FlowSummaryQuery, now = new Date()): Promise<FlowSummaryDto> {
    const locked = !(await this.allFlow(userId)) && !FLOW_FREE_SYMBOLS.includes(q.symbol);
    const span = FLOW_WINDOW_MS[q.window];
    const from = new Date(now.getTime() - span);
    const bucketMs = span / BUCKETS;
    const empty: FlowSummaryDto = {
      symbol: q.symbol,
      window: q.window,
      from: from.toISOString(),
      to: now.toISOString(),
      whales: { buyUsd: 0, sellUsd: 0, buys: 0, sells: 0, netUsd: 0 },
      liquidations: { longUsd: 0, shortUsd: 0, longs: 0, shorts: 0, byExchange: [], largest: null },
      series: Array.from({ length: BUCKETS }, (_, i) => ({
        t: new Date(from.getTime() + i * bucketMs).toISOString(),
        whaleBuyUsd: 0,
        whaleSellUsd: 0,
        longLiqUsd: 0,
        shortLiqUsd: 0,
      })),
      sources: [],
      locked,
    };
    if (locked) return empty;
    const db = this.prisma.client;
    const range = Prisma.sql`symbol = ${q.symbol} AND at >= ${from} AND at <= ${now}`;
    const bucket = Prisma.sql`LEAST(${BUCKETS - 1}, FLOOR((EXTRACT(EPOCH FROM at) * 1000 - ${from.getTime()}) / ${bucketMs}))::int`;
    const [whaleSides, liqGroups, whaleSeries, liqSeries, largest, lastBy, status] =
      await Promise.all([
        db.$queryRaw<{ side: string; usd: unknown; count: bigint }[]>`
          SELECT side, SUM(usd) AS usd, COUNT(*) AS count FROM whale_trades WHERE ${range} GROUP BY side`,
        db.$queryRaw<{ exchange: FlowExchange; side: string; usd: unknown; count: bigint }[]>`
          SELECT exchange::text AS exchange, side, SUM(usd) AS usd, COUNT(*) AS count
            FROM liquidation_events WHERE ${range} GROUP BY 1, 2`,
        db.$queryRaw<{ b: number; side: string; usd: unknown }[]>`
          SELECT ${bucket} AS b, side, SUM(usd) AS usd FROM whale_trades WHERE ${range} GROUP BY 1, 2`,
        db.$queryRaw<{ b: number; side: string; usd: unknown }[]>`
          SELECT ${bucket} AS b, side, SUM(usd) AS usd FROM liquidation_events WHERE ${range} GROUP BY 1, 2`,
        db.liquidationEvent.findFirst({
          where: { symbol: q.symbol, at: { gte: from, lte: now } },
          orderBy: { usd: "desc" },
        }),
        db.$queryRaw<{ exchange: FlowExchange; last: Date }[]>`
          SELECT exchange::text AS exchange, MAX(at) AS last FROM (
            SELECT exchange, at FROM whale_trades WHERE ${range}
            UNION ALL SELECT exchange, at FROM liquidation_events WHERE ${range}) x GROUP BY 1`,
        this.status(),
      ]);

    const out = empty;
    for (const r of whaleSides) {
      if (r.side === "buy") {
        out.whales.buyUsd = n(r.usd);
        out.whales.buys = Number(r.count);
      } else {
        out.whales.sellUsd = n(r.usd);
        out.whales.sells = Number(r.count);
      }
    }
    out.whales.netUsd = out.whales.buyUsd - out.whales.sellUsd;
    const byEx = new Map<FlowExchange, { longUsd: number; shortUsd: number; count: number }>();
    for (const r of liqGroups) {
      const e = byEx.get(r.exchange) ?? { longUsd: 0, shortUsd: 0, count: 0 };
      if (r.side === "long") {
        e.longUsd += n(r.usd);
        out.liquidations.longUsd += n(r.usd);
        out.liquidations.longs += Number(r.count);
      } else {
        e.shortUsd += n(r.usd);
        out.liquidations.shortUsd += n(r.usd);
        out.liquidations.shorts += Number(r.count);
      }
      e.count += Number(r.count);
      byEx.set(r.exchange, e);
    }
    out.liquidations.byExchange = FLOW_EXCHANGES.filter((e) => byEx.has(e)).map((e) => ({
      exchange: e,
      ...(byEx.get(e) as { longUsd: number; shortUsd: number; count: number }),
    }));
    out.liquidations.largest = largest ? liqDto(largest) : null;
    for (const r of whaleSeries) {
      const s = out.series[r.b];
      if (!s) continue;
      if (r.side === "buy") s.whaleBuyUsd += n(r.usd);
      else s.whaleSellUsd += n(r.usd);
    }
    for (const r of liqSeries) {
      const s = out.series[r.b];
      if (!s) continue;
      if (r.side === "long") s.longLiqUsd += n(r.usd);
      else s.shortLiqUsd += n(r.usd);
    }
    const fresh = status && now.getTime() - Date.parse(status.updatedAt) < LIVE_STATUS_MS;
    const lastOf = new Map(lastBy.map((r) => [r.exchange, r.last]));
    out.sources = FLOW_EXCHANGES.map((e) => ({
      exchange: e,
      live: Boolean(fresh && status?.exchanges[e]?.connected),
      lastAt: lastOf.get(e)?.toISOString() ?? null,
    }));
    return out;
  }

  async whales(userId: string, q: FlowFeedQuery): Promise<FlowFeedPage<WhaleTradeDto>> {
    if (!(await this.allFlow(userId)) && !FLOW_FREE_SYMBOLS.includes(q.symbol))
      return { items: [], nextCursor: null, locked: true };
    const rows = await this.prisma.client.whaleTrade.findMany({
      where: {
        symbol: q.symbol,
        ...(q.exchange ? { exchange: q.exchange } : {}),
        ...(q.side === "buy" || q.side === "sell" ? { side: q.side } : {}),
        ...(q.minUsd ? { usd: { gte: q.minUsd } } : {}),
        ...after(q.cursor),
      },
      // Newest trade first by exchange time (rows from different feeds can arrive out of order).
      orderBy: [{ at: "desc" }, { id: "desc" }],
      take: PAGE + 1,
    });
    const page = rows.slice(0, PAGE);
    return {
      items: page.map((r) => ({
        id: r.id.toString(),
        exchange: r.exchange as FlowExchange,
        symbol: r.symbol,
        side: r.side as "buy" | "sell",
        price: Number(r.price),
        qty: Number(r.qty),
        usd: Number(r.usd),
        at: r.at.toISOString(),
      })),
      nextCursor: rows.length > PAGE ? cursorOf(page.at(-1)) : null,
      locked: false,
    };
  }

  async liquidations(userId: string, q: FlowFeedQuery): Promise<FlowFeedPage<LiquidationDto>> {
    if (!(await this.allFlow(userId)) && !FLOW_FREE_SYMBOLS.includes(q.symbol))
      return { items: [], nextCursor: null, locked: true };
    const rows = await this.prisma.client.liquidationEvent.findMany({
      where: {
        symbol: q.symbol,
        ...(q.exchange ? { exchange: q.exchange } : {}),
        ...(q.side === "long" || q.side === "short" ? { side: q.side } : {}),
        ...(q.minUsd ? { usd: { gte: q.minUsd } } : {}),
        ...after(q.cursor),
      },
      // Newest trade first by exchange time (rows from different feeds can arrive out of order).
      orderBy: [{ at: "desc" }, { id: "desc" }],
      take: PAGE + 1,
    });
    const page = rows.slice(0, PAGE);
    return {
      items: page.map(liqDto),
      nextCursor: rows.length > PAGE ? cursorOf(page.at(-1)) : null,
      locked: false,
    };
  }

  /** Dashboard table: trend bias per timeframe with 24h whale flow and liquidations. */
  async bias(userId: string, now = new Date()): Promise<MarketBiasDto> {
    const all = await this.allFlow(userId);
    const allowed: DeskSymbol[] = all ? [...DESK_SYMBOLS] : [DESK_FREE_SYMBOL];
    const since = new Date(now.getTime() - FLOW_WINDOW_MS["24h"]);
    const [snaps, whales, liqs] = await Promise.all([
      snapshotsOf(this.prisma.client).getMany(allowed.map(deskKey)),
      this.prisma.client.$queryRaw<{ symbol: string; side: string; usd: unknown }[]>`
        SELECT symbol, side, SUM(usd) AS usd FROM whale_trades
         WHERE symbol IN (${Prisma.join(allowed)}) AND at >= ${since} GROUP BY 1, 2`,
      this.prisma.client.$queryRaw<{ symbol: string; side: string; usd: unknown }[]>`
        SELECT symbol, side, SUM(usd) AS usd FROM liquidation_events
         WHERE symbol IN (${Prisma.join(allowed)}) AND at >= ${since} GROUP BY 1, 2`,
    ]);
    const desks = new Map(snaps.map((s) => [s.key, s.data as unknown as MarketDeskDto]));
    const sum = (rows: typeof whales, symbol: string, side: string) =>
      rows.filter((r) => r.symbol === symbol && r.side === side).reduce((a, r) => a + n(r.usd), 0);
    return {
      allowed,
      items: allowed.map((symbol) => {
        const d = desks.get(deskKey(symbol));
        return {
          symbol,
          name: DESK_NAMES[symbol],
          price: d?.price ?? null,
          change24hPct: d?.change24hPct ?? null,
          bias: d?.bias ?? [],
          computedAt: d?.computedAt ?? null,
          whaleNet24hUsd: sum(whales, symbol, "buy") - sum(whales, symbol, "sell"),
          liquidations24h: {
            longUsd: sum(liqs, symbol, "long"),
            shortUsd: sum(liqs, symbol, "short"),
          },
        };
      }),
    };
  }
}

/** Rows strictly after the cursor in (time desc, id desc) order. */
function after(cursor: string | undefined) {
  if (!cursor) return {};
  const [ms, id] = cursor.split(":");
  const at = new Date(Number(ms));
  return { OR: [{ at: { lt: at } }, { at, id: { lt: BigInt(id as string) } }] };
}

const cursorOf = (r: { at: Date; id: bigint } | undefined) =>
  r ? `${r.at.getTime()}:${r.id.toString()}` : null;

function liqDto(r: {
  id: bigint;
  exchange: string;
  symbol: string;
  side: string;
  price: Prisma.Decimal;
  qty: Prisma.Decimal;
  usd: Prisma.Decimal;
  at: Date;
}): LiquidationDto {
  return {
    id: r.id.toString(),
    exchange: r.exchange as FlowExchange,
    symbol: r.symbol,
    side: r.side as "long" | "short",
    price: Number(r.price),
    qty: Number(r.qty),
    usd: Number(r.usd),
    at: r.at.toISOString(),
  };
}
