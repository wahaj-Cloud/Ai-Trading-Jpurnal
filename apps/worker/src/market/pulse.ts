import { type ClosePoint, correlateToBtc } from "@atc/analytics";
import type { PrismaClient } from "@atc/db";
import {
  type AdapterConfig,
  fetchBinanceRecentCandles,
  fetchBinanceUniverse,
} from "@atc/exchange-adapters";
import { PULSE_WINDOW_SPEC, PULSE_WINDOWS, type PulseWindow } from "@atc/shared";
import { log } from "../logger.js";

/** Coins covered, by 24h traded value. */
export const PULSE_COINS = 100;
/** New listings swing wildly and have little history: left out for their first 30 days. */
const MIN_LISTED_MS = 30 * 86_400_000;
const HOURLY_KEEP_DAYS = 120;
const CONCURRENCY = 6;
const BTC = "BTCUSDT";

export interface PulseDeps {
  db: PrismaClient;
  config: AdapterConfig;
  now?: () => number;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (x: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

/**
 * Hourly Market Pulse: correlation and beta of the top coins to BTC over 24h, 7d and 30d. Rows are
 * replaced in one transaction, so readers never see a half-updated table, and a retry of the same
 * hour simply overwrites it (no duplicates).
 */
export async function runMarketPulse(deps: PulseDeps): Promise<{ coins: number; ms: number }> {
  const started = Date.now();
  const now = (deps.now ?? Date.now)();
  const binance = deps.config.binance ?? {};
  const universe = (await fetchBinanceUniverse(binance))
    .filter((s) => !s.tradfi) // crypto coins only
    .filter((s) => s.symbol === BTC || now - s.onboardDate >= MIN_LISTED_MS)
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, PULSE_COINS);
  if (!universe.some((s) => s.symbol === BTC)) throw new Error("BTCUSDT missing from the universe");

  const closes = async (symbol: string, w: PulseWindow): Promise<ClosePoint[]> => {
    const spec = PULSE_WINDOW_SPEC[w];
    const candles = await fetchBinanceRecentCandles(
      binance,
      symbol,
      spec.interval,
      spec.points,
      now,
    );
    return candles.map((c) => ({ t: c.t, c: c.c }));
  };
  const btc = Object.fromEntries(
    await Promise.all(PULSE_WINDOWS.map(async (w) => [w, await closes(BTC, w)] as const)),
  ) as Record<PulseWindow, ClosePoint[]>;

  const computedAt = new Date(now);
  const rows = (
    await mapLimit(universe, CONCURRENCY, async (coin) => {
      const out = [];
      for (const w of PULSE_WINDOWS) {
        try {
          const series = coin.symbol === BTC ? btc[w] : await closes(coin.symbol, w);
          const r = correlateToBtc(series, btc[w], PULSE_WINDOW_SPEC[w].points);
          if (r) out.push({ coin, window: w, r });
        } catch (err) {
          log.warn("market pulse coin failed", { symbol: coin.symbol, window: w, err });
        }
      }
      return out;
    })
  ).flat();

  const rank = new Map(universe.map((u, i) => [u.symbol, i + 1]));
  const hour = new Date(Math.floor(now / 3_600_000) * 3_600_000);
  await deps.db.$transaction([
    deps.db.marketCorrelation.deleteMany({}),
    deps.db.marketCorrelation.createMany({
      data: rows.map(({ coin, window, r }) => ({
        symbol: coin.symbol,
        window,
        rank: rank.get(coin.symbol) ?? 999,
        quoteVolume: coin.quoteVolume.toFixed(2),
        corr: r.corr,
        beta: r.beta,
        relStrength: Number((r.coinReturn - r.btcReturn).toFixed(6)),
        coinReturn: r.coinReturn,
        btcReturn: r.btcReturn,
        points: r.points,
        computedAt,
      })),
    }),
    deps.db.marketCorrelationHourly.createMany({
      data: rows
        .filter((x) => x.window === "24h")
        .map(({ coin, r }) => ({ symbol: coin.symbol, hour, corr: r.corr, beta: r.beta })),
      skipDuplicates: true,
    }),
    deps.db.marketCorrelationHourly.deleteMany({
      where: { hour: { lt: new Date(now - HOURLY_KEEP_DAYS * 86_400_000) } },
    }),
  ]);
  await fillEntryCorrelations(deps.db);
  return { coins: new Set(rows.map((r) => r.coin.symbol)).size, ms: Date.now() - started };
}

/**
 * Stamps each recent trade with its coin's BTC correlation at entry: the newest hourly reading taken
 * at most 3 hours before the trade opened. Only trades still missing it are touched.
 */
export async function fillEntryCorrelations(db: PrismaClient): Promise<number> {
  return db.$executeRaw`
    WITH m AS (
      SELECT p.id, h.corr, h.beta
      FROM positions p
      JOIN LATERAL (
        SELECT corr, beta FROM market_correlation_hourly h
        WHERE h.symbol = p.symbol
          AND h.hour <= p.opened_at
          AND h.hour > p.opened_at - interval '3 hours'
        ORDER BY h.hour DESC
        LIMIT 1
      ) h ON true
      WHERE p.btc_corr_at_entry IS NULL
        AND p.opened_at > now() - interval '120 days'
    )
    UPDATE positions SET btc_corr_at_entry = m.corr, btc_beta_at_entry = m.beta
    FROM m WHERE positions.id = m.id`;
}
