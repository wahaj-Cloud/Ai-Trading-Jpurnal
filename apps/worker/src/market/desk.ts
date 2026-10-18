import { type CoachModel, writeDeskSummary } from "@atc/coach";
import type { Prisma, PrismaClient } from "@atc/db";
import {
  type AdapterConfig,
  fetchBinanceFlowCandles,
  fetchBinanceFunding,
  fetchBinanceMarketNow,
  fetchBinanceRecentCandles,
  openInterest,
} from "@atc/exchange-adapters";
import {
  DESK_SUMMARY_MINUTES,
  DESK_SYMBOLS,
  type DeskEventDto,
  type DeskSymbol,
  deskKey,
  isMetal,
  type LiquidationMapDto,
  type MarketDeskDto,
  type TimeframeBiasDto,
} from "@atc/shared";
import { buildDesk, closedFourHour, type DeskCandle, timeframeBias } from "@atc/ta";
import { log } from "../logger.js";

const H = 3_600_000;
const CANDLES = 1000;

export interface DeskDeps {
  db: PrismaClient;
  config: AdapterConfig;
  model: CoachModel;
  now?: () => number;
}

const toEvent = (e: {
  title: string;
  currency: string;
  impact: string;
  startsAt: Date;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
}): DeskEventDto => ({
  title: e.title,
  currency: e.currency,
  impact: e.impact as DeskEventDto["impact"],
  startsAt: e.startsAt.toISOString(),
  actual: e.actual,
  forecast: e.forecast,
  previous: e.previous,
});

/** Combined open-interest change over the last 24h on the exchanges that list the market. */
export async function oiChange(config: AdapterConfig, symbol: string, now: number) {
  const { series } = await openInterest(config, symbol, "7d", now - 25 * H, now);
  let first = 0;
  let last = 0;
  for (const points of Object.values(series)) {
    const recent = points.filter((p) => p.t >= now - 24.5 * H);
    const a = recent[0];
    const b = recent.at(-1);
    if (a && b && a.oi > 0 && b.t > a.t) {
      first += a.oi;
      last += b.oi;
    }
  }
  return first > 0 ? (last / first - 1) * 100 : null;
}

async function settle<T>(what: string, symbol: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    log.warn("market desk input unavailable", {
      what,
      symbol,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Every 15 minutes: the Market Context Desk for each desk market. Inputs are public market data
 * (Binance candles and funding; Binance, Bybit and OKX open interest), the latest liquidation map,
 * the economic calendar and CoinMarketCap's mood readings. The AI summary is rewritten at most
 * hourly. A market whose price data is unavailable keeps its previous desk.
 */
export async function runMarketDesk(
  deps: DeskDeps,
): Promise<{ saved: DeskSymbol[]; failed: DeskSymbol[]; summaries: number }> {
  const now = (deps.now ?? Date.now)();
  const saved: DeskSymbol[] = [];
  const failed: DeskSymbol[] = [];
  let summaries = 0;

  const [recentRows, nextRow, snapshots] = await Promise.all([
    deps.db.economicEvent.findMany({
      where: {
        impact: "HIGH",
        currency: { in: ["USD", "ALL"] },
        startsAt: { gte: new Date(now - 24 * H), lte: new Date(now) },
        actual: { not: null },
      },
      orderBy: { startsAt: "desc" },
      take: 8,
    }),
    deps.db.economicEvent.findFirst({
      where: {
        impact: "HIGH",
        currency: { in: ["USD", "ALL"] },
        startsAt: { gt: new Date(now) },
      },
      orderBy: { startsAt: "asc" },
    }),
    deps.db.marketSnapshot.findMany({
      where: { key: { in: ["fear_greed", "global", ...DESK_SYMBOLS.map(deskKey)] } },
    }),
  ]);
  const snap = new Map(snapshots.map((s) => [s.key, s.data as Record<string, unknown>]));
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const fearGreed = num(snap.get("fear_greed")?.value);
  const btcDominance = num(snap.get("global")?.btcDominance);
  const recentEvents = recentRows.map(toEvent);
  const nextEvent = nextRow ? toEvent(nextRow) : null;

  for (const symbol of DESK_SYMBOLS) {
    try {
      const raw = await fetchBinanceFlowCandles(
        symbol,
        "1h",
        now - (CANDLES + 1) * H,
        now,
        deps.config.binance,
      );
      // Only closed candles.
      const candles1h: DeskCandle[] = raw.filter((c) => c.t + H <= now);
      const [daily, nowData, funding, oi, liq] = await Promise.all([
        settle(
          "daily candles",
          symbol,
          fetchBinanceRecentCandles(deps.config.binance ?? {}, symbol, "1d", 400, now),
        ),
        settle("ticker", symbol, fetchBinanceMarketNow(deps.config.binance ?? {}, symbol)),
        settle(
          "funding",
          symbol,
          fetchBinanceFunding(deps.config.binance ?? {}, symbol, now - 24 * H, now),
        ),
        settle("open interest", symbol, oiChange(deps.config, symbol, now)),
        deps.db.liquidationMap.findUnique({
          where: { symbol_window: { symbol, window: "24h" } },
          select: { data: true },
        }),
      ]);
      const desk = buildDesk({
        symbol,
        now,
        candles1h,
        // The live rate for the next settlement; the last settled one only as a fallback.
        fundingRate: nowData?.nextFundingRate ?? funding?.at(-1)?.rate ?? null,
        live: nowData ? { price: nowData.lastPrice, change24hPct: nowData.change24hPct } : null,
        oiChange24hPct: oi,
        liqClusters:
          (liq?.data as Pick<LiquidationMapDto, "clusters"> | undefined)?.clusters ?? null,
        recentEvents,
        nextEvent,
        fearGreed: isMetal(symbol) ? null : fearGreed,
        btcDominance: isMetal(symbol) ? null : btcDominance,
      });
      if (!desk) throw new Error("no price data");
      // Trend bias per timeframe, closed candles only.
      const bias = [
        daily ? timeframeBias(daily, "1d") : null,
        timeframeBias(closedFourHour(candles1h), "4h"),
        timeframeBias(candles1h, "1h"),
      ].filter((b): b is TimeframeBiasDto => b !== null);

      // The summary is kept for an hour; rewritten sooner only when the tally changes.
      const prev = snap.get(deskKey(symbol)) as MarketDeskDto | undefined;
      let summary = prev?.summary ?? null;
      let summaryAt = prev?.summaryAt ?? null;
      const age = summaryAt ? now - Date.parse(summaryAt) : Number.POSITIVE_INFINITY;
      const tallyChanged = JSON.stringify(prev?.leans) !== JSON.stringify(desk.leans);
      if (
        deps.model.enabled &&
        (age >= DESK_SUMMARY_MINUTES * 60_000 || (tallyChanged && age >= 15 * 60_000))
      ) {
        const fresh = await settle("summary", symbol, writeDeskSummary(deps.model, desk));
        if (fresh) {
          summary = fresh;
          summaryAt = new Date(now).toISOString();
          summaries++;
        }
      }
      if (!deps.model.enabled) {
        summary = null;
        summaryAt = null;
      }
      const data: MarketDeskDto = { ...desk, summary, summaryAt, bias };
      const json = data as unknown as Prisma.InputJsonValue;
      await deps.db.marketSnapshot.upsert({
        where: { key: deskKey(symbol) },
        create: { key: deskKey(symbol), data: json, updatedAt: new Date(now) },
        update: { data: json, updatedAt: new Date(now) },
      });
      saved.push(symbol);
    } catch (err) {
      failed.push(symbol);
      log.warn("market desk failed", {
        symbol,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { saved, failed, summaries };
}
