import { planLimits } from "@atc/coach";
import type { Prisma } from "@atc/db";
import {
  LIQ_MAP_FREE_SYMBOL,
  LIQ_MAP_SYMBOLS,
  type LiquidationMapDto,
  type LiquidationMapQuery,
  type LiquidationMapResponse,
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
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

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
  constructor(private readonly prisma: PrismaService) {}

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
    if (!row) return { status: "unavailable", reason: "pending" };
    const data = row.data as unknown as Omit<LiquidationMapDto, "symbol" | "window" | "computedAt">;
    return {
      status: "ok",
      map: {
        ...data,
        symbol: row.symbol,
        window: q.window,
        computedAt: row.computedAt.toISOString(),
      },
    };
  }
}
