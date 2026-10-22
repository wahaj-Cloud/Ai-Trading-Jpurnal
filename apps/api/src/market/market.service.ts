import { planLimits } from "@atc/coach";
import type { Prisma } from "@atc/db";
import { snapshotsOf } from "@atc/db";
import {
  type AdapterConfig,
  computeLiquidationMap,
  type LiquidationMapData,
} from "@atc/exchange-adapters";
import {
  alignmentNote,
  DESK_FREE_SYMBOL,
  DESK_NAMES,
  DESK_SYMBOLS,
  type DeskAlignmentDto,
  type DeskEventDto,
  type DeskQuery,
  type DeskSymbol,
  deskKey,
  deskSymbolOf,
  LIQ_MAP_FREE_SYMBOL,
  LIQ_MAP_STATUS_KEY,
  LIQ_MAP_SYMBOLS,
  type LiqMapRunStatus,
  type LiqMapWindow,
  type LiquidationMapQuery,
  type LiquidationMapResponse,
  type MarketDeskDto,
  type MarketDeskResponse,
  type MarketOverviewDto,
  type MarketPulseDto,
  type MarketPulseQuery,
  PULSE_LINKS,
  PULSE_MIN_GROUP,
  type PulseLink,
  type PulseMyTradesDto,
  type PulseRowDto,
  type PulseSymbolDto,
  type PulseWindow,
  pulseLink,
  UNLIMITED,
  USD_SETTLEMENT_ASSETS,
} from "@atc/shared";
import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** A map older than this means the worker has stopped updating it: rebuild on request. */
const LIQ_MAP_STALE_MS = 20 * 60_000;

type Row = Prisma.MarketCorrelationGetPayload<object>;
const LINK_CODES = Object.keys(PULSE_LINKS) as PulseLink[];

function rowDto(r: Row, corr30d: number | undefined): PulseRowDto {
  return {
    symbol: r.symbol,
    rank: r.rank,
    quoteVolume24h: r.quoteVolume.toString(),
    corr: r.corr,
    beta: r.beta,
    relStrength: r.relStrength,
    coinReturn: r.coinReturn,
    link: pulseLink(r.corr),
    decoupled: r.window === "24h" && corr30d !== undefined && corr30d >= 0.7 && r.corr < 0.3,
  };
}

/** Market Pulse: read-only views of the hourly table the worker writes. */
@Injectable()
export class MarketService {
  private readonly log = new Logger(MarketService.name);
  /** One on-demand build per market and window at a time; later requests share it. */
  private readonly building = new Map<string, Promise<LiquidationMapData>>();
  private readonly adapterConfig: AdapterConfig;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) env: Env,
  ) {
    this.adapterConfig = {
      binance: { futuresBaseUrl: env.BINANCE_FUTURES_BASE_URL },
      bybit: { baseUrl: env.BYBIT_BASE_URL },
      okx: { baseUrl: env.OKX_BASE_URL },
    };
  }

  async pulse(userId: string, q: MarketPulseQuery): Promise<MarketPulseDto> {
    const limits = await planLimits(this.prisma.client, userId);
    const windowsLocked = limits.marketPulseAllWindows !== 1;
    const [rows, thirty] = await Promise.all([
      this.prisma.client.marketCorrelation.findMany({
        where: { window: q.window },
        orderBy: { rank: "asc" },
      }),
      this.prisma.client.marketCorrelation.findMany({
        where: { window: "30d" },
        select: { symbol: true, corr: true },
      }),
    ]);
    const corr30 = new Map(thirty.map((r) => [r.symbol, r.corr]));
    const all = rows.map((r) => rowDto(r, corr30.get(r.symbol)));
    const btc = rows.find((r) => r.symbol === "BTCUSDT");
    const base = {
      window: q.window,
      computedAt: rows[0]?.computedAt.toISOString() ?? null,
      btcReturn: btc?.coinReturn ?? null,
    };
    const emptyTotals = { FOLLOWS: 0, LOOSE: 0, INDEPENDENT: 0, OPPOSITE: 0, decoupled: 0 };
    // Locked windows send no figures at all (the limit is enforced here, not just hidden).
    if (q.window !== "24h" && windowsLocked)
      return {
        ...base,
        rows: [],
        locked: { windows: true, hiddenCoins: all.length },
        totals: emptyTotals,
      };

    const visible =
      limits.marketPulseCoins === UNLIMITED
        ? all
        : all.filter((r) => r.rank <= limits.marketPulseCoins);
    const totals = { ...emptyTotals };
    for (const r of visible) {
      totals[r.link] += 1;
      if (r.decoupled) totals.decoupled += 1;
    }
    const filtered = visible.filter((r) =>
      q.filter === "all" ? true : q.filter === "decoupled" ? r.decoupled : r.link === q.filter,
    );
    const key: Record<MarketPulseQuery["sort"], (r: PulseRowDto) => number> = {
      volume: (r) => r.rank,
      corr: (r) => -r.corr,
      beta: (r) => -r.beta,
      rs: (r) => -r.relStrength,
    };
    filtered.sort((a, b) => key[q.sort](a) - key[q.sort](b) || a.rank - b.rank);
    return {
      ...base,
      rows: filtered,
      locked: { windows: windowsLocked, hiddenCoins: all.length - visible.length },
      totals,
    };
  }

  async symbol(userId: string, symbol: string, now = new Date()): Promise<PulseSymbolDto> {
    const limits = await planLimits(this.prisma.client, userId);
    const rows = await this.prisma.client.marketCorrelation.findMany({ where: { symbol } });
    if (!rows.length) throw new NotFoundException("This coin is not in Market Pulse right now.");
    const rank = rows[0]?.rank ?? 999;
    if (limits.marketPulseCoins !== UNLIMITED && rank > limits.marketPulseCoins)
      throw new ForbiddenException(
        `Your plan covers the top ${limits.marketPulseCoins} coins. Upgrade to see every coin.`,
      );
    const corr30 = rows.find((r) => r.window === "30d")?.corr;
    const windows: PulseSymbolDto["windows"] = {};
    for (const r of rows) {
      if (r.window !== "24h" && limits.marketPulseAllWindows !== 1) continue;
      windows[r.window as PulseWindow] = rowDto(r, corr30);
    }
    const history = await this.prisma.client.marketCorrelationHourly.findMany({
      where: { symbol, hour: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
      orderBy: { hour: "asc" },
      select: { hour: true, corr: true },
    });
    return {
      symbol,
      computedAt: rows[0]?.computedAt.toISOString() ?? null,
      windows,
      history: history.map((h) => ({ t: h.hour.toISOString(), corr: h.corr })),
    };
  }

  /** The trader's results by how linked the coin was to BTC at entry (last 365 days). */
  async myTrades(userId: string, now = new Date()): Promise<PulseMyTradesDto> {
    const rows = await this.prisma.client.$queryRaw<
      Array<{ link: PulseLink; trades: bigint; wins: bigint; losses: bigint; net: string | null }>
    >`
      SELECT CASE
          WHEN btc_corr_at_entry >= 0.7 THEN 'FOLLOWS'
          WHEN btc_corr_at_entry >= 0.3 THEN 'LOOSE'
          WHEN btc_corr_at_entry > -0.3 THEN 'INDEPENDENT'
          ELSE 'OPPOSITE' END AS link,
        count(*) AS trades,
        count(*) FILTER (WHERE net_pnl > 0) AS wins,
        count(*) FILTER (WHERE net_pnl < 0) AS losses,
        sum(net_pnl)::text AS net
      FROM positions
      WHERE user_id = ${userId}::uuid
        AND status = 'CLOSED'
        AND net_pnl IS NOT NULL
        AND btc_corr_at_entry IS NOT NULL
        AND settle_asset = ANY(${[...USD_SETTLEMENT_ASSETS]})
        AND closed_at >= ${new Date(now.getTime() - 365 * 86_400_000)}
      GROUP BY 1`;
    const by = new Map(rows.map((r) => [r.link, r]));
    const groups = LINK_CODES.map((link) => {
      const r = by.get(link);
      const trades = Number(r?.trades ?? 0);
      const wins = Number(r?.wins ?? 0);
      const losses = Number(r?.losses ?? 0);
      const net = Number(r?.net ?? 0);
      return {
        link,
        trades,
        winRate: wins + losses ? Number((wins / (wins + losses)).toFixed(4)) : null,
        netPnl: net.toFixed(2),
        avgPnl: trades ? (net / trades).toFixed(2) : null,
        enough: trades >= PULSE_MIN_GROUP,
      };
    });
    return { groups, total: groups.reduce((a, g) => a + g.trades, 0) };
  }

  /**
   * The latest estimated liquidation map the worker saved. Free plans see Bitcoin only; the map is
   * read from the table (never computed in the request), so this is fast and costs nothing extra.
   */
  async liquidationMap(userId: string, q: LiquidationMapQuery): Promise<LiquidationMapResponse> {
    if (!(LIQ_MAP_SYMBOLS as readonly string[]).includes(q.symbol)) {
      return { status: "unavailable", reason: "unsupported" };
    }
    const limits = await planLimits(this.prisma.client, userId);
    if (limits.liquidationMap === 0 && q.symbol !== LIQ_MAP_FREE_SYMBOL)
      return { status: "locked" };
    const row = await this.prisma.client.liquidationMap.findUnique({
      where: { symbol_window: { symbol: q.symbol, window: q.window } },
    });
    const fresh = row && Date.now() - row.computedAt.getTime() < LIQ_MAP_STALE_MS;
    if (row && fresh) return this.mapResponse(q.symbol, q.window, row.data, row.computedAt);

    // No recent map from the worker: build it now, save it for everyone, and say why if we cannot.
    try {
      const data = await this.buildLiquidationMap(q.symbol, q.window);
      return this.mapResponse(q.symbol, q.window, data, new Date());
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.log.warn(`liquidation map ${q.symbol} ${q.window} failed: ${detail}`);
      // An older map is better than none.
      if (row) return this.mapResponse(q.symbol, q.window, row.data, row.computedAt);
      const status = await this.prisma.client.liquidationMap.findUnique({
        where: { symbol_window: LIQ_MAP_STATUS_KEY },
      });
      const run = status?.data as unknown as LiqMapRunStatus | undefined;
      return {
        status: "unavailable",
        reason: "failed",
        detail: run
          ? `${detail}. Background updates last ran ${run.at} (${run.maps} built, ${run.failed} failed).`
          : `${detail}. Background updates have not run yet.`,
      };
    }
  }

  private buildLiquidationMap(symbol: string, window: LiqMapWindow): Promise<LiquidationMapData> {
    const key = `${symbol}:${window}`;
    const pending = this.building.get(key);
    if (pending) return pending;
    const job = (async () => {
      const now = Date.now();
      const data = await computeLiquidationMap(this.adapterConfig, symbol, window, now);
      const json = data as unknown as Prisma.InputJsonValue;
      const computedAt = new Date(now);
      await this.prisma.client.liquidationMap.upsert({
        where: { symbol_window: { symbol, window } },
        create: { symbol, window, data: json, computedAt },
        update: { data: json, computedAt },
      });
      return data;
    })().finally(() => this.building.delete(key));
    this.building.set(key, job);
    return job;
  }

  private mapResponse(
    symbol: string,
    window: LiqMapWindow,
    data: unknown,
    computedAt: Date,
  ): LiquidationMapResponse {
    return {
      status: "ok",
      map: {
        ...(data as LiquidationMapData),
        symbol,
        window,
        computedAt: computedAt.toISOString(),
      },
    };
  }

  /** The next high-impact US (or global) release, read live so a countdown never shows a past one. */
  async nextEvent(now = new Date()): Promise<DeskEventDto | null> {
    const e = await this.prisma.client.economicEvent.findFirst({
      where: { impact: "HIGH", currency: { in: ["USD", "ALL"] }, startsAt: { gt: now } },
      orderBy: { startsAt: "asc" },
    });
    return e
      ? {
          title: e.title,
          currency: e.currency,
          impact: "HIGH",
          startsAt: e.startsAt.toISOString(),
          actual: e.actual,
          forecast: e.forecast,
          previous: e.previous,
        }
      : null;
  }

  /**
   * Market Context Desk for one market, plus how the trader's open positions on desk markets line
   * up with their market's drivers. Free plans see Bitcoin; Pro and Premium every desk market.
   */
  async desk(userId: string, q: DeskQuery): Promise<MarketDeskResponse> {
    const limits = await planLimits(this.prisma.client, userId);
    const allowed: DeskSymbol[] = limits.marketDesk === 1 ? [...DESK_SYMBOLS] : [DESK_FREE_SYMBOL];
    if (!allowed.includes(q.symbol)) return { status: "locked", allowed };
    const [snaps, open, next] = await Promise.all([
      snapshotsOf(this.prisma.client).getMany(allowed.map(deskKey)),
      this.prisma.client.openPosition.findMany({
        where: { userId },
        select: { symbol: true, direction: true },
        orderBy: { symbol: "asc" },
        take: 50,
      }),
      this.nextEvent(),
    ]);
    const by = new Map(snaps.map((s) => [s.key, s.data as unknown as MarketDeskDto]));
    const found = by.get(deskKey(q.symbol));
    if (!found) return { status: "unavailable", reason: "pending", allowed };
    const desk: MarketDeskDto = { ...found, nextEvent: next };
    const now = Date.now();
    const alignment: DeskAlignmentDto[] = [];
    for (const p of open) {
      const symbol = deskSymbolOf(p.symbol);
      const d = symbol ? by.get(deskKey(symbol)) : undefined;
      if (!symbol || !d) continue;
      const mine = p.direction === "LONG" ? "up" : "down";
      const counts = {
        with: d.drivers.filter((x) => x.lean === mine).length,
        against: d.drivers.filter((x) => x.lean !== mine && x.lean !== "neutral").length,
        neutral: d.drivers.filter((x) => x.lean === "neutral").length,
      };
      const base = { symbol, positionSymbol: p.symbol, direction: p.direction, ...counts };
      alignment.push({ ...base, note: alignmentNote(base, DESK_NAMES[symbol], next, now) });
    }
    return { status: "ok", desk, alignment, allowed };
  }

  /** Dashboard market overview (CoinMarketCap), as last saved by the worker. Same for everyone. */
  async overview(): Promise<MarketOverviewDto> {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [snaps, points] = await Promise.all([
      snapshotsOf(this.prisma.client).getMany(["global", "fear_greed", "altcoin_season"]),
      this.prisma.client.marketCapPoint.findMany({
        where: { ts: { gte: since } },
        orderBy: { ts: "asc" },
      }),
    ]);
    const by = new Map(snaps.map((s) => [s.key, s.data as Record<string, unknown>]));
    const g = by.get("global") as
      | {
          totalMarketCapUsd: number;
          totalVolume24hUsd: number | null;
          btcDominance: number | null;
          change24hPct: number | null;
          updatedAt: string;
        }
      | undefined;
    const fg = by.get("fear_greed") as
      | { value: number; label: string; updatedAt: string }
      | undefined;
    const alt = by.get("altcoin_season") as { value: number; updatedAt: string } | undefined;

    // One point per hour keeps the mini chart light; the newest reading is always included.
    const hourly = new Map<number, { t: number; usd: number }>();
    for (const p of points) {
      const t = p.ts.getTime();
      hourly.set(Math.floor(t / 3_600_000), { t, usd: Number(p.totalMarketCap) });
    }
    const sparkline = [...hourly.values()];
    let change = g?.change24hPct ?? null;
    if (change === null && g && sparkline.length > 0) {
      const dayAgo = Date.now() - 86_400_000;
      const ref = sparkline.find((p) => p.t >= dayAgo - 3_600_000);
      if (ref && ref.t <= dayAgo + 3_600_000 && ref.usd > 0) {
        change = (g.totalMarketCapUsd / ref.usd - 1) * 100;
      }
    }
    return {
      marketCap: g
        ? {
            usd: g.totalMarketCapUsd,
            change24hPct: change,
            volume24hUsd: g.totalVolume24hUsd,
            btcDominance: g.btcDominance,
            sparkline,
            updatedAt: g.updatedAt,
          }
        : null,
      fearGreed: fg ?? null,
      altcoinSeason: alt ?? null,
    };
  }
}
