import { ExchangeHttpError, fetchBinanceRecentCandles } from "@atc/exchange-adapters";
import {
  CARD_CANDLES,
  CARD_TF_MS,
  CARD_TFS,
  type CandleRow,
  type CardTf,
  type CoinCandlesDto,
  cardCandlesTtlMs,
} from "@atc/shared";
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Redis } from "ioredis";
import { ENV, type Env } from "../config/env.js";

/** Cache entries: the rows, or "none" for a symbol Binance does not list. */
const key = (symbol: string, tf: CardTf) => `cc:v1:${symbol}:${tf}`;
const UNKNOWN = "none";
const UNKNOWN_TTL_MS = 10 * 60_000;
/** While Binance has not yet published the candle that just closed, try again this soon. */
const LATE_TTL_MS = 5_000;

type Fetcher = (symbol: string, tf: CardTf, limit: number, now: number) => Promise<CandleRow[]>;

/**
 * Coin-card candles through our servers. Every visitor asking for the same coin and timeframe
 * shares one Binance request per candle close (Redis, across API instances), and requests in
 * flight on one instance are shared too. Public market data only; no keys involved.
 */
@Injectable()
export class CandlesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CandlesService.name);
  private redis: Redis | null = null;
  private readonly inflight = new Map<string, Promise<CandleRow[] | null>>();
  private fetcher: Fetcher;

  constructor(@Inject(ENV) private readonly env: Env) {
    const binance = { futuresBaseUrl: env.BINANCE_FUTURES_BASE_URL };
    this.fetcher = async (symbol, tf, limit, now) =>
      (await fetchBinanceRecentCandles(binance, symbol, tf, limit, now)).map((c) => [
        c.t,
        c.o,
        c.h,
        c.l,
        c.c,
        c.v,
      ]);
  }

  onModuleInit(): void {
    if (this.env.NODE_ENV === "test") return;
    this.connect(new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: 2, family: 0 }));
  }

  /** Wires Redis and, in tests, a stand-in for Binance. */
  connect(redis: Redis | null, fetcher?: Fetcher): void {
    this.redis = redis;
    redis?.on("error", (err) => this.logger.warn(`candles redis: ${err.message}`));
    if (fetcher) this.fetcher = fetcher;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }

  async coin(symbol: string, now = Date.now()): Promise<CoinCandlesDto> {
    const sets = await Promise.all(CARD_TFS.map((tf) => this.series(symbol, tf, now)));
    if (sets.some((s) => s === null))
      throw new NotFoundException("Binance does not list this coin");
    return {
      symbol,
      candles: Object.fromEntries(CARD_TFS.map((tf, i) => [tf, sets[i]])) as Record<
        CardTf,
        CandleRow[]
      >,
    };
  }

  /** One timeframe's closed candles, from the cache or Binance. Null when the coin is unknown. */
  private async series(symbol: string, tf: CardTf, now: number): Promise<CandleRow[] | null> {
    const k = key(symbol, tf);
    const cached = await this.redis?.get(k).catch(() => null);
    if (cached === UNKNOWN) return null;
    if (cached) {
      try {
        return JSON.parse(cached) as CandleRow[];
      } catch {
        // A damaged entry is simply fetched again.
      }
    }
    const running = this.inflight.get(k);
    if (running) return running;
    const job = this.load(symbol, tf, now).finally(() => this.inflight.delete(k));
    this.inflight.set(k, job);
    return job;
  }

  private async load(symbol: string, tf: CardTf, now: number): Promise<CandleRow[] | null> {
    const k = key(symbol, tf);
    let rows: CandleRow[];
    try {
      rows = await this.fetcher(symbol, tf, CARD_CANDLES[tf], now);
    } catch (err) {
      if (err instanceof ExchangeHttpError && err.status === 400) {
        await this.redis?.set(k, UNKNOWN, "PX", UNKNOWN_TTL_MS).catch(() => undefined);
        return null;
      }
      this.logger.warn(`card candles ${symbol} ${tf}: ${(err as Error).message}`);
      throw new ServiceUnavailableException("Market data is not reachable right now");
    }
    if (rows.length === 0) {
      await this.redis?.set(k, UNKNOWN, "PX", UNKNOWN_TTL_MS).catch(() => undefined);
      return null;
    }
    // The candle that closed last should be there; if Binance is a moment late, keep it briefly.
    const step = CARD_TF_MS[tf];
    const lastClosedOpen = Math.floor(now / step) * step - step;
    const late = (rows.at(-1)?.[0] ?? 0) < lastClosedOpen;
    const ttl = late ? LATE_TTL_MS : cardCandlesTtlMs(tf, now);
    await this.redis?.set(k, JSON.stringify(rows), "PX", ttl).catch(() => undefined);
    return rows;
  }
}
