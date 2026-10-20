import { planLimits } from "@atc/coach";
import {
  type AcrossCell,
  isPinned,
  ORDERFLOW_WINDOWS,
  type OrderflowAcross,
  type OrderflowQuery,
  type OrderflowResponse,
  type OrderflowWindow,
  type OrderflowWindowSnapshot,
  orderflowKey,
  REGIMES,
  SCALP_KEY,
  type ScalpEventDto,
  type ScalpResponse,
  type ScalpSnapshot,
  UNLIMITED,
} from "@atc/shared";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

/** Binance names for coins other exchanges quote per single unit (PEPE → 1000PEPEUSDT). */
const binanceNames = (base: string) => {
  const b = base.toUpperCase();
  return [`${b}USDT`, `1000${b}USDT`, `1000000${b}USDT`, `1M${b}USDT`];
};

/** Order Flow: read-only view of the snapshot the worker writes every 5 minutes. */
@Injectable()
export class OrderflowService {
  constructor(private readonly prisma: PrismaService) {}

  /** Symbols of the trader's open positions, under Binance's names. */
  private async held(userId: string): Promise<Set<string>> {
    const open = await this.prisma.client.openPosition.findMany({
      where: { userId, account: { status: "ACTIVE" } },
      select: { baseAsset: true },
    });
    return new Set(open.flatMap((p) => binanceNames(p.baseAsset)));
  }

  /**
   * Every window's figures for the given coins, in one read that pulls only four small fields out
   * of each scan (not the series). A window is left out when its scan is more than 15 minutes
   * away from the one being shown, so a stalled scan never sits next to a fresh one.
   */
  private async across(symbols: string[], computedAt: string): Promise<OrderflowAcross> {
    if (symbols.length === 0) return {};
    const keys = ORDERFLOW_WINDOWS.map((w) => `orderflow:${w}`);
    const rows = await this.prisma.client.$queryRaw<
      Array<{ key: string; at: string | null; symbol: string; p: number; s: string; r: string }>
    >`
      SELECT s.key, s.data->>'computedAt' AS at, c->>'symbol' AS symbol,
             (c->>'buyPressurePct')::float8 AS p, c->>'strength' AS s, c->>'regime' AS r
        FROM market_snapshots s, jsonb_array_elements(s.data->'coins') c
       WHERE s.key = ANY(${keys}) AND c->>'symbol' = ANY(${symbols})`;
    const ref = Date.parse(computedAt);
    const out: OrderflowAcross = Object.fromEntries(symbols.map((s) => [s, {}]));
    for (const row of rows) {
      if (!row.at || Math.abs(Date.parse(row.at) - ref) > 15 * 60_000) continue;
      const w = row.key.slice("orderflow:".length) as OrderflowWindow;
      const cells = out[row.symbol];
      if (cells) cells[w] = { p: row.p, s: row.s, r: row.r } as AcrossCell;
    }
    return out;
  }

  /** High-impact US releases from 15 minutes ago to 4 hours ahead: the moments scalps get hit. */
  private async scalpEvents(now: Date): Promise<ScalpEventDto[]> {
    const rows = await this.prisma.client.economicEvent.findMany({
      where: {
        impact: "HIGH",
        currency: { in: ["USD", "ALL"] },
        startsAt: {
          gte: new Date(now.getTime() - 15 * 60_000),
          lte: new Date(now.getTime() + 4 * 3_600_000),
        },
      },
      orderBy: { startsAt: "asc" },
      take: 5,
      select: { title: true, currency: true, startsAt: true },
    });
    return rows.map((r) => ({
      title: r.title,
      currency: r.currency,
      startsAt: r.startsAt.toISOString(),
    }));
  }

  /** Scalping desk: every coin on every timeframe, with VWAP distance and order books. */
  async scalp(userId: string, now = new Date()): Promise<ScalpResponse> {
    const [limits, row, held, events] = await Promise.all([
      planLimits(this.prisma.client, userId),
      this.prisma.client.marketSnapshot.findUnique({ where: { key: SCALP_KEY } }),
      this.held(userId),
      this.scalpEvents(now),
    ]);
    const snap = row?.data as ScalpSnapshot | undefined;
    if (!snap?.coins)
      return {
        events,
        computedAt: null,
        asOf: null,
        universe: 0,
        coins: [],
        limit: null,
        hidden: 0,
        mine: [],
      };
    const cap = limits.marketPulseCoins ?? UNLIMITED;
    // Gold and silver are shown on every plan.
    const coins =
      cap === UNLIMITED
        ? snap.coins
        : snap.coins.filter((c) => c.rank <= cap || isPinned(c.symbol));
    return {
      events,
      computedAt: snap.computedAt,
      asOf: snap.asOf,
      universe: snap.universe,
      coins,
      limit: cap === UNLIMITED ? null : cap,
      hidden: snap.coins.length - coins.length,
      mine: snap.coins.filter((c) => held.has(c.symbol)).map((c) => c.symbol),
    };
  }

  async get(userId: string, q: OrderflowQuery): Promise<OrderflowResponse> {
    const [limits, row, held] = await Promise.all([
      planLimits(this.prisma.client, userId),
      this.prisma.client.marketSnapshot.findUnique({ where: { key: orderflowKey(q.window) } }),
      this.held(userId),
    ]);
    const snap = row?.data as OrderflowWindowSnapshot | undefined;
    if (!snap?.coins) {
      return {
        window: q.window,
        coins: [],
        counts: Object.fromEntries(REGIMES.map((r) => [r, 0])) as OrderflowResponse["counts"],
        buying: 0,
        selling: 0,
        netFlowUsd: 0,
        computedAt: null,
        asOf: null,
        universe: 0,
        limit: null,
        hidden: 0,
        mine: [],
        across: {},
      };
    }
    const cap = limits.marketPulseCoins ?? UNLIMITED;
    // The per-coin figures beyond the plan are not sent at all; the market-wide counts are.
    const coins =
      cap === UNLIMITED
        ? snap.coins
        : snap.coins.filter((c) => c.rank <= cap || isPinned(c.symbol));
    return {
      window: snap.window,
      coins,
      counts: snap.counts,
      buying: snap.buying,
      selling: snap.selling,
      netFlowUsd: snap.netFlowUsd,
      computedAt: snap.computedAt,
      asOf: snap.asOf,
      universe: snap.universe,
      limit: cap === UNLIMITED ? null : cap,
      hidden: snap.coins.length - coins.length,
      mine: snap.coins.filter((c) => held.has(c.symbol)).map((c) => c.symbol),
      across: await this.across(
        coins.map((c) => c.symbol),
        snap.computedAt,
      ),
    };
  }
}
