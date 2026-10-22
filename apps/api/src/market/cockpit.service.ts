import { planLimits } from "@atc/coach";
import { snapshotsOf } from "@atc/db";
import {
  ALIGNMENT_LABEL,
  type Alignment,
  alignment,
  buildScalpReadout,
  type CockpitDto,
  type CockpitQuery,
  type CockpitTf,
  DESK_SYMBOLS,
  type EntryCount,
  FLOW_SYMBOLS,
  LIQ_MAP_FREE_SYMBOL,
  LIQ_MAP_SYMBOLS,
  type LiquidationClusterDto,
  nearestCockpitZones,
  nearestLevels,
  RATING_REFRESH_MIN,
  RATING_TFS,
  RATINGS_KEY,
  type RatingsSnapshot,
  type ScalpRecordDto,
  SESSIONS,
  sessionAt,
  USD_SETTLEMENT_ASSETS,
  ZONE_STEP_MS,
  ZONE_TFS,
  ZONES_KEY,
  type ZoneSet,
  type ZoneTf,
} from "@atc/shared";
import { dec, str, ZERO } from "@atc/trade-engine";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { FlowService } from "./flow.service.js";
import { OrderflowService } from "./orderflow.service.js";

const LIQ_FRESH_MS = 20 * 60_000;
const RECORD_DAYS = 180;
const SCALP_MAX_HOLD_MS = 60 * 60_000;
const RECORD_MIN = 10;

const NAMES: Record<string, string> = { XAUUSDT: "Gold", XAGUSDT: "Silver" };
/** "1000PEPEUSDT" → PEPE: the base asset other exchanges and brokers use. */
export function baseOf(symbol: string): string {
  return symbol.replace(/USDT$/, "").replace(/^(1000000|1000|1M)(?=[A-Z])/, "");
}
const sessionId = (d: Date) => sessionAt(d).id;

function freshRatings(r: RatingsSnapshot[string] | undefined, now: Date): CockpitDto["ratings"] {
  if (!r) return null;
  const out: CockpitDto["ratings"] = {};
  for (const tf of RATING_TFS) {
    const x = r[tf];
    if (!x) continue;
    const maxAge = (3 * RATING_REFRESH_MIN[tf] + 3) * 60_000;
    if (now.getTime() - Date.parse(x.computedAt) <= maxAge) out[tf] = x;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Scalp Cockpit: one market read for a 5- or 15-minute trade, joining the scalping snapshot,
 * Market Flow, trend bias, the estimated liquidation map, headlines, the economic calendar and the
 * trader's own short trades on this market. Each part keeps its own plan rule.
 */
@Injectable()
export class CockpitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderflow: OrderflowService,
    private readonly flow: FlowService,
  ) {}

  async get(userId: string, q: CockpitQuery, now = new Date()): Promise<CockpitDto> {
    const db = this.prisma.client;
    const symbol = q.symbol;
    const base = baseOf(symbol);
    const isFlow = (FLOW_SYMBOLS as readonly string[]).includes(symbol);
    const isMap = (LIQ_MAP_SYMBOLS as readonly string[]).includes(symbol);
    const [
      scalp,
      flowSummary,
      bias,
      limits,
      mapRow,
      corr,
      headlines,
      record,
      open,
      ratingsRow,
      zoneRows,
    ] = await Promise.all([
      this.orderflow.scalp(userId, now),
      isFlow
        ? this.flow.summary(
            userId,
            { symbol: symbol as (typeof FLOW_SYMBOLS)[number], window: q.tf },
            now,
          )
        : Promise.resolve(null),
      this.flow.bias(userId, now),
      planLimits(db, userId),
      isMap
        ? db.liquidationMap.findUnique({
            where: { symbol_window: { symbol, window: "24h" } },
          })
        : Promise.resolve(null),
      symbol === "BTCUSDT"
        ? Promise.resolve(null)
        : db.marketCorrelation.findFirst({
            where: { symbol, window: "24h" },
            select: { corr: true },
          }),
      db.newsItem.findMany({
        where: {
          impact: "HIGH",
          publishedAt: { gte: new Date(now.getTime() - 60 * 60_000), lte: now },
        },
        orderBy: { publishedAt: "desc" },
        take: 8,
        select: { title: true, publishedAt: true, why: true, url: true, clusterId: true },
      }),
      this.record(userId, base, now, q.tf),
      db.openPosition.findMany({
        where: {
          userId,
          account: { status: "ACTIVE" },
          baseAsset: { in: [base, `1000${base}`], mode: "insensitive" },
        },
        select: { direction: true, entryPrice: true, unrealizedPnl: true, exchange: true },
      }),
      snapshotsOf(db).get(RATINGS_KEY),
      // Only this market's zones, not the whole record.
      db.$queryRaw<Array<{ m: unknown }>>`
          SELECT data->'markets'->${symbol} AS m FROM market_snapshots WHERE key = ${ZONES_KEY}`,
    ]);

    const locked: string[] = [];
    const coin = scalp.coins.find((c) => c.symbol === symbol) ?? null;
    if (!coin && scalp.hidden > 0) locked.push("this market (top coins on your plan)");
    const flowOk = flowSummary && !flowSummary.locked;
    if (flowSummary?.locked) locked.push("whale orders and liquidations");
    const biasRow = bias.items.find((i) => i.symbol === symbol);
    // The desk refreshes every 15 minutes; a trend older than 2 hours is not read.
    const biasFresh =
      biasRow?.computedAt && now.getTime() - Date.parse(biasRow.computedAt) <= 2 * 3_600_000;
    const bias1h = biasFresh
      ? (biasRow?.bias.find((b) => b.timeframe === "1h")?.state ?? null)
      : null;
    // Trend bias covers the desk markets (Bitcoin only on Free).
    if (!biasRow && (DESK_SYMBOLS as readonly string[]).includes(symbol)) locked.push("trend bias");

    // Biggest estimated liquidation pools within 3%: shorts above price, longs below.
    let liqAbove: CockpitDto["liqAbove"] = null;
    let liqBelow: CockpitDto["liqBelow"] = null;
    const mapAllowed = limits.liquidationMap !== 0 || symbol === LIQ_MAP_FREE_SYMBOL;
    if (isMap && !mapAllowed) locked.push("liquidation map");
    if (
      coin &&
      mapRow &&
      mapAllowed &&
      now.getTime() - mapRow.computedAt.getTime() < LIQ_FRESH_MS
    ) {
      const clusters = (
        (mapRow.data as { clusters?: LiquidationClusterDto[] }).clusters ?? []
      ).filter((c) => Math.abs(c.price / coin.price - 1) <= 0.03);
      const pick = (side: "long" | "short", above: boolean) => {
        const best = clusters
          .filter((c) => c.side === side && (above ? c.price > coin.price : c.price < coin.price))
          .sort((a, b) => b.usd - a.usd)[0];
        return best
          ? {
              label: side === "short" ? "Short liquidations" : "Long liquidations",
              price: best.price,
              usd: best.usd,
              distPct: (best.price / coin.price - 1) * 100,
            }
          : null;
      };
      liqAbove = pick("short", true);
      liqBelow = pick("long", false);
    }

    // One headline per story.
    const seen = new Set<string>();
    const stories = headlines.filter((h) => {
      const k = h.clusterId ?? h.title;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const hot = stories.filter(
      (h) => now.getTime() - h.publishedAt.getTime() <= 30 * 60_000,
    ).length;

    const whales = flowOk
      ? {
          buyUsd: flowSummary.whales.buyUsd,
          sellUsd: flowSummary.whales.sellUsd,
          buys: flowSummary.whales.buys,
          sells: flowSummary.whales.sells,
        }
      : null;
    const liquidations = flowOk
      ? { longUsd: flowSummary.liquidations.longUsd, shortUsd: flowSummary.liquidations.shortUsd }
      : null;
    const readout = coin
      ? buildScalpReadout({
          tf: q.tf,
          coin,
          now: now.getTime(),
          computedAt: scalp.computedAt,
          events: scalp.events,
          hotHeadlines: hot,
          whales,
          liquidations,
          bias1h,
        })
      : { rows: [], flags: [], tally: { up: 0, down: 0, neutral: 0 } };
    const levels = coin ? nearestLevels(coin) : { above: null, below: null };
    // 1H and 4H supply/demand zones; a record three candles late is not shown as current.
    const market = (zoneRows[0]?.m ?? null) as Partial<Record<ZoneTf, ZoneSet>> | null;
    const freshZones: Partial<Record<ZoneTf, ZoneSet>> = {};
    for (const tf of ZONE_TFS) {
      const set = market?.[tf];
      if (set && now.getTime() - Date.parse(set.asOf) <= 3 * ZONE_STEP_MS[tf]) freshZones[tf] = set;
    }
    const zones = coin ? nearestCockpitZones(freshZones, coin.price) : [];

    return {
      symbol,
      name: NAMES[symbol] ?? base,
      tf: q.tf,
      symbols: scalp.coins.map((c) => c.symbol),
      coin,
      computedAt: scalp.computedAt,
      rows: readout.rows,
      tally: readout.tally,
      flags: readout.flags,
      session: sessionAt(now).label,
      events: scalp.events,
      headlines: stories.slice(0, 5).map((h) => ({
        title: h.title,
        publishedAt: h.publishedAt.toISOString(),
        why: h.why,
        url: h.url,
      })),
      levelAbove: levels.above,
      levelBelow: levels.below,
      liqAbove,
      liqBelow,
      zones,
      whales,
      liquidations,
      bias: biasFresh ? (biasRow?.bias ?? []) : [],
      bias1h,
      hotHeadlines: hot,
      btcCorr24h: corr?.corr ?? null,
      record,
      open: open.map((p) => ({
        direction: p.direction,
        entryPrice: p.entryPrice?.toString() ?? null,
        unrealizedPnl: p.unrealizedPnl?.toString() ?? null,
        exchange: p.exchange,
      })),
      // Gauges that missed three refreshes are left out rather than shown as current.
      ratings: coin
        ? freshRatings((ratingsRow?.data as RatingsSnapshot | undefined)?.[symbol], now)
        : null,
      locked,
    };
  }

  /**
   * The trader's own scalps on this market: closed, USD-settled trades held an hour or less over
   * the last 180 days, on any exchange or broker (matched by base asset, so Exness XAUUSD counts
   * for gold), with results per session.
   */
  async record(
    userId: string,
    base: string,
    now: Date,
    tf: CockpitTf = "5m",
  ): Promise<ScalpRecordDto | null> {
    const rows = await this.prisma.client.position.findMany({
      where: {
        userId,
        status: "CLOSED",
        baseAsset: { in: [base, `1000${base}`], mode: "insensitive" },
        settleAsset: { in: [...USD_SETTLEMENT_ASSETS] },
        openedAt: { gte: new Date(now.getTime() - RECORD_DAYS * 86_400_000) },
        closedAt: { not: null },
        netPnl: { not: null },
      },
      select: { openedAt: true, closedAt: true, netPnl: true, direction: true, entryReadout: true },
    });
    const scalps = rows.filter(
      (r) => r.closedAt && r.closedAt.getTime() - r.openedAt.getTime() <= SCALP_MAX_HOLD_MS,
    );
    if (scalps.length === 0) return null;
    let net = ZERO;
    let wins = 0;
    let hold = 0;
    const bySession = new Map<
      string,
      { trades: number; wins: number; net: ReturnType<typeof dec> }
    >();
    for (const r of scalps) {
      const pnl = dec(r.netPnl?.toString() ?? "0");
      net = net.plus(pnl);
      if (pnl.gt(0)) wins++;
      hold += (r.closedAt as Date).getTime() - r.openedAt.getTime();
      const s = sessionId(r.openedAt);
      const g = bySession.get(s) ?? { trades: 0, wins: 0, net: ZERO };
      g.trades++;
      if (pnl.gt(0)) g.wins++;
      g.net = g.net.plus(pnl);
      bySession.set(s, g);
    }
    // By the readings at entry.
    const byAlign = new Map<
      Alignment,
      { trades: number; wins: number; net: ReturnType<typeof dec> }
    >();
    let stamped = 0;
    for (const r of scalps) {
      const e = r.entryReadout as { tf5?: EntryCount | null; tf15?: EntryCount | null } | null;
      const c = e && !("none" in e) ? (tf === "5m" ? e.tf5 : e.tf15) : null;
      if (!c) continue;
      stamped++;
      const k = alignment(r.direction, c);
      const g = byAlign.get(k) ?? { trades: 0, wins: 0, net: ZERO };
      const pnl = dec(r.netPnl?.toString() ?? "0");
      g.trades++;
      if (pnl.gt(0)) g.wins++;
      g.net = g.net.plus(pnl);
      byAlign.set(k, g);
    }
    return {
      readings: {
        stamped,
        groups: (["with", "against", "mixed"] as const)
          .filter((k) => byAlign.has(k))
          .map((k) => {
            const g = byAlign.get(k) as {
              trades: number;
              wins: number;
              net: ReturnType<typeof dec>;
            };
            return {
              key: k,
              label: ALIGNMENT_LABEL[k],
              trades: g.trades,
              winRate: g.wins / g.trades,
              netPnl: str(g.net),
            };
          }),
      },
      trades: scalps.length,
      wins,
      winRate: wins / scalps.length,
      netPnl: str(net),
      avgHoldMin: hold / scalps.length / 60_000,
      sessions: (Object.keys(SESSIONS) as Array<keyof typeof SESSIONS>)
        .filter((id) => bySession.has(id))
        .map((id) => {
          const g = bySession.get(id) as {
            trades: number;
            wins: number;
            net: ReturnType<typeof dec>;
          };
          return {
            id,
            label: SESSIONS[id].label,
            trades: g.trades,
            winRate: g.wins / g.trades,
            netPnl: str(g.net),
          };
        }),
      enough: scalps.length >= RECORD_MIN,
    };
  }
}
