import { planLimits } from "@atc/coach";
import { snapshotsOf } from "@atc/db";
import {
  type BiasState,
  buildTradeCheck,
  CHECK_MIN_GROUP,
  CHECK_STALE_MS,
  type CheckRecordDto,
  type CheckRecordGroupDto,
  contextKey,
  DESK_FREE_SYMBOL,
  DESK_NAMES,
  DESK_SYMBOLS,
  type DeskSymbol,
  deskKey,
  deskSymbolOf,
  FLOW_STATUS_KEY,
  type FlowStatus,
  isMetal,
  type LiquidationMapDto,
  MACRO_KEY,
  type MacroDto,
  type MarketContextDto,
  type MarketDeskDto,
  STABLECOINS_KEY,
  type StablecoinDto,
  type TradeCheckDto,
  type TradeCheckQuery,
  type TradeCheckResponse,
  USD_SETTLEMENT_ASSETS,
} from "@atc/shared";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { MarketService } from "./market.service.js";

const H = 3_600_000;
/** Narrows the trade query in the database; deskSymbolOf then checks each symbol exactly. */
const DESK_PREFIXES: Record<DeskSymbol, string[]> = {
  BTCUSDT: ["BTC", "XBT"],
  ETHUSDT: ["ETH"],
  SOLUSDT: ["SOL"],
  XAUUSDT: ["XAU", "GOLD"],
  XAGUSDT: ["XAG", "SILVER"],
};
const DAY = 24 * H;
/** Funding at entry counts as "crowded on your side" past the same lines Trade Check uses. */
const CROWDED_LONG = 0.0003;
const CROWDED_SHORT = -0.0001;
/** An entry this close to a high-impact US release counts as "near a release". */
const EVENT_WINDOW = 2 * H;

interface TradeRow {
  direction: "LONG" | "SHORT";
  openedAt: Date;
  net: number;
}

/** Latest row at or before `t` in a list sorted by time, if within `maxAge`. */
function latestAtOrBefore<T extends { t: number }>(rows: T[], t: number, maxAge: number): T | null {
  let lo = 0;
  let hi = rows.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((rows[mid] as T).t <= t) {
      hit = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (hit < 0) return null;
  const row = rows[hit] as T;
  return t - row.t <= maxAge ? row : null;
}

const trendGroup = (state: BiasState, dir: "LONG" | "SHORT") =>
  state === "range" ? "range" : (state === "up") === (dir === "LONG") ? "with" : "against";

const crowded = (rate: number, dir: "LONG" | "SHORT") =>
  dir === "LONG" ? rate > CROWDED_LONG : rate < CROWDED_SHORT;

export const RECORD_GROUPS: Array<{ key: string; label: string }> = [
  { key: "d1_with", label: "With the daily trend" },
  { key: "d1_against", label: "Against the daily trend" },
  { key: "d1_range", label: "Daily chart ranging" },
  { key: "h4_with", label: "With the 4-hour trend" },
  { key: "h4_against", label: "Against the 4-hour trend" },
  { key: "h4_range", label: "4-hour chart ranging" },
  { key: "event_near", label: "Within 2h of a high-impact US release" },
  { key: "event_clear", label: "Away from releases" },
  { key: "funding_crowded", label: "Funding crowded on your side" },
  { key: "funding_normal", label: "Funding not crowded on your side" },
];

/**
 * Trade Check: all of a market's readings judged by fixed rules, plus how the trader has done in
 * the same conditions. Everything is read from what the worker saved; nothing calls an exchange.
 */
@Injectable()
export class TradeCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly market: MarketService,
  ) {}

  async check(userId: string, q: TradeCheckQuery, at = new Date()): Promise<TradeCheckResponse> {
    const limits = await planLimits(this.prisma.client, userId);
    const allowed: DeskSymbol[] = limits.marketDesk === 1 ? [...DESK_SYMBOLS] : [DESK_FREE_SYMBOL];
    if (!allowed.includes(q.symbol)) return { status: "locked", allowed };
    const now = at.getTime();
    const db = this.prisma.client;
    const keys = [
      deskKey(q.symbol),
      contextKey(q.symbol),
      "fear_greed",
      "global",
      "altcoin_season",
      MACRO_KEY,
      STABLECOINS_KEY,
      FLOW_STATUS_KEY,
    ];
    const [snaps, liq, nextEvent] = await Promise.all([
      snapshotsOf(db).getMany(keys),
      db.liquidationMap.findUnique({
        where: { symbol_window: { symbol: q.symbol, window: "24h" } },
        select: { data: true, computedAt: true },
      }),
      this.market.nextEvent(at),
    ]);
    const by = new Map(snaps.map((s) => [s.key, s.data as unknown]));
    const desk = (by.get(deskKey(q.symbol)) as MarketDeskDto | undefined) ?? null;
    const context = (by.get(contextKey(q.symbol)) as MarketContextDto | undefined) ?? null;
    if (!desk && !context) return { status: "unavailable", reason: "pending", allowed };
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const fg = by.get("fear_greed") as { value?: unknown; label?: unknown } | undefined;
    const flow = await this.flow24h(
      q.symbol,
      now,
      by.get(FLOW_STATUS_KEY) as FlowStatus | undefined,
    );
    const clusters =
      liq && now - liq.computedAt.getTime() <= 30 * 60_000
        ? ((liq.data as unknown as Pick<LiquidationMapDto, "clusters">).clusters ?? null)
        : null;

    const check = buildTradeCheck({
      symbol: q.symbol,
      name: DESK_NAMES[q.symbol],
      now,
      desk,
      context,
      fearGreed:
        num(fg?.value) !== null
          ? { value: num(fg?.value) as number, label: String(fg?.label ?? "") }
          : null,
      btcDominance: num((by.get("global") as { btcDominance?: unknown } | undefined)?.btcDominance),
      altSeason: num((by.get("altcoin_season") as { value?: unknown } | undefined)?.value),
      flow,
      liqClusters: clusters,
      macro: (by.get(MACRO_KEY) as MacroDto | undefined) ?? null,
      stablecoins: (by.get(STABLECOINS_KEY) as StablecoinDto | undefined) ?? null,
      nextEvent,
      recentEvents: desk?.recentEvents ?? [],
    });
    if (!flow && !isMetal(q.symbol))
      check.missing.push("Whale orders and liquidations (the live feed needs a full 24 hours)");
    const fresh = context && now - Date.parse(context.computedAt) <= CHECK_STALE_MS.context;
    const record = await this.record(userId, q.symbol, now, {
      bias: desk?.bias ?? [],
      recentEvents: desk?.recentEvents ?? [],
      nextEvent: check.nextEvent,
      fundingRate: fresh ? context.fundingRate : null,
    });
    return { status: "ok", check, record, allowed };
  }

  /**
   * 24h whale orders and liquidations, only while the live feed is running and its stored history
   * covers the whole 24 hours (a worker restart only leaves a gap of seconds, so it does not count).
   */
  private async flow24h(symbol: string, now: number, status: FlowStatus | undefined) {
    if (!status) return null;
    if (now - Date.parse(status.updatedAt) > 10 * 60_000) return null;
    const from = new Date(now - DAY);
    const to = new Date(now);
    const db = this.prisma.client;
    if (Date.parse(status.since) > now - DAY) {
      const oldest = await db.liquidationEvent.findFirst({
        orderBy: { at: "asc" },
        select: { at: true },
      });
      if (!oldest || oldest.at.getTime() > now - DAY + 30 * 60_000) return null;
    }
    const [w, l] = await Promise.all([
      db.$queryRaw<{ side: string; usd: unknown; count: bigint }[]>`
        SELECT side, SUM(usd) AS usd, COUNT(*) AS count FROM whale_trades
        WHERE symbol = ${symbol} AND at >= ${from} AND at <= ${to} GROUP BY side`,
      db.$queryRaw<{ side: string; usd: unknown }[]>`
        SELECT side, SUM(usd) AS usd FROM liquidation_events
        WHERE symbol = ${symbol} AND at >= ${from} AND at <= ${to} GROUP BY side`,
    ]);
    const val = (rows: { side: string; usd: unknown }[], side: string) =>
      Number(rows.find((r) => r.side === side)?.usd ?? 0);
    return {
      whaleBuyUsd: val(w, "buy"),
      whaleSellUsd: val(w, "sell"),
      whaleCount: w.reduce((s, r) => s + Number(r.count), 0),
      longLiqUsd: val(l, "long"),
      shortLiqUsd: val(l, "short"),
    };
  }

  /**
   * The trader's closed USD-settled trades on this market over the last 365 days, matched with the
   * daily and 4-hour trend, the funding rate and the release calendar at the moment they opened.
   */
  async record(
    userId: string,
    symbol: DeskSymbol,
    now: number,
    current: {
      bias: NonNullable<MarketDeskDto["bias"]>;
      recentEvents: MarketDeskDto["recentEvents"];
      nextEvent: TradeCheckDto["nextEvent"];
      fundingRate: number | null;
    },
  ): Promise<CheckRecordDto> {
    const db = this.prisma.client;
    const since = new Date(now - 365 * DAY);
    const rows = await db.position.findMany({
      where: {
        userId,
        status: "CLOSED",
        netPnl: { not: null },
        settleAsset: { in: [...USD_SETTLEMENT_ASSETS] },
        openedAt: { gte: since },
        OR: DESK_PREFIXES[symbol].map((p) => ({
          symbol: { startsWith: p, mode: "insensitive" as const },
        })),
      },
      select: { symbol: true, direction: true, openedAt: true, netPnl: true },
      orderBy: { openedAt: "desc" },
      take: 5000,
    });
    const trades: TradeRow[] = rows
      .filter((r) => deskSymbolOf(r.symbol) === symbol)
      .map((r) => ({ direction: r.direction, openedAt: r.openedAt, net: Number(r.netPnl) }));

    const first = trades.reduce((m, t) => Math.min(m, t.openedAt.getTime()), now);
    const [trend, funding, events] = await Promise.all([
      db.marketTrendHistory.findMany({
        where: { symbol, at: { gte: new Date(first - 2 * DAY), lte: new Date(now) } },
        orderBy: { at: "asc" },
      }),
      db.fundingRateHistory.findMany({
        where: { symbol, at: { gte: new Date(first - DAY), lte: new Date(now) } },
        orderBy: { at: "asc" },
      }),
      db.economicEvent.findMany({
        where: {
          impact: "HIGH",
          currency: { in: ["USD", "ALL"] },
          startsAt: { gte: new Date(first - EVENT_WINDOW), lte: new Date(now + EVENT_WINDOW) },
        },
        select: { startsAt: true },
        orderBy: { startsAt: "asc" },
      }),
    ]);
    const series = (tf: string) =>
      trend
        .filter((r) => r.timeframe === tf)
        .map((r) => ({ t: r.at.getTime(), state: r.state as BiasState }));
    const d1 = series("1d");
    const h4 = series("4h");
    const fund = funding.map((r) => ({ t: r.at.getTime(), rate: Number(r.rate) }));
    const evTimes = events.map((e) => ({ t: e.startsAt.getTime() }));
    const nearEvent = (t: number) => {
      // The latest release at or before t + window; near when within the window either side.
      const e = latestAtOrBefore(evTimes, t + EVENT_WINDOW, 2 * EVENT_WINDOW);
      return e !== null;
    };

    const acc = new Map<string, { trades: number; wins: number; losses: number; net: number }>();
    const put = (key: string, net: number) => {
      const g = acc.get(key) ?? { trades: 0, wins: 0, losses: 0, net: 0 };
      g.trades++;
      if (net > 0) g.wins++;
      else if (net < 0) g.losses++;
      g.net += net;
      acc.set(key, g);
    };
    let matched = 0;
    for (const tr of trades) {
      const t = tr.openedAt.getTime();
      const a = latestAtOrBefore(d1, t, DAY + 60_000);
      const b = latestAtOrBefore(h4, t, 4 * H + 60_000);
      const f = latestAtOrBefore(fund, t, 9 * H);
      if (!a && !b && !f) continue;
      matched++;
      if (a) put(`d1_${trendGroup(a.state, tr.direction)}`, tr.net);
      if (b) put(`h4_${trendGroup(b.state, tr.direction)}`, tr.net);
      put(nearEvent(t) ? "event_near" : "event_clear", tr.net);
      if (f) put(crowded(f.rate, tr.direction) ? "funding_crowded" : "funding_normal", tr.net);
    }
    const groups: CheckRecordGroupDto[] = RECORD_GROUPS.map(({ key, label }) => {
      const g = acc.get(key) ?? { trades: 0, wins: 0, losses: 0, net: 0 };
      return {
        key,
        label,
        trades: g.trades,
        winRate: g.wins + g.losses ? Number((g.wins / (g.wins + g.losses)).toFixed(4)) : null,
        netPnl: g.net.toFixed(2),
        avgPnl: g.trades ? (g.net / g.trades).toFixed(2) : null,
        enough: g.trades >= CHECK_MIN_GROUP,
      };
    });

    // The groups a new long or short would fall in right now.
    const nowState = (tf: string) => current.bias.find((b) => b.timeframe === tf)?.state;
    const rateNow = current.fundingRate;
    const recent = current.recentEvents.some(
      (e) => Math.abs(Date.parse(e.startsAt) - now) <= EVENT_WINDOW,
    );
    const next = current.nextEvent ? Date.parse(current.nextEvent.startsAt) - now : null;
    const eventNow = recent || (next !== null && next >= 0 && next <= EVENT_WINDOW);
    const nowFor = (dir: "LONG" | "SHORT") => {
      const out: string[] = [];
      const s1 = nowState("1d");
      const s4 = nowState("4h");
      if (s1) out.push(`d1_${trendGroup(s1, dir)}`);
      if (s4) out.push(`h4_${trendGroup(s4, dir)}`);
      out.push(eventNow ? "event_near" : "event_clear");
      if (rateNow !== null) out.push(crowded(rateNow, dir) ? "funding_crowded" : "funding_normal");
      return out;
    };
    return { total: matched, groups, now: { long: nowFor("LONG"), short: nowFor("SHORT") } };
  }
}
