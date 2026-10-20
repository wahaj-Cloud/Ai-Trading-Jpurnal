import type { PrismaClient } from "@atc/db";
import {
  type AdapterConfig,
  fetchBinanceDeltaCandles,
  fetchBinanceOpenInterestNow,
} from "@atc/exchange-adapters";
import {
  type DeltaCandle,
  FAST_LOOKBACK_CANDLES,
  isPinned,
  LIVE_ALIVE_KEY,
  LIVE_FLOW_CHANNEL,
  LIVE_FLOW_KEY,
  LIVE_OI_FAST_COINS,
  LIVE_OI_FAST_MS,
  LIVE_OI_SLOW_MS,
  LIVE_SERIES_POINTS,
  LIVE_TICK_MS,
  type LiveCoin,
  type LiveTick,
  liveCoin,
  SCALP_KEY,
  type ScalpSnapshot,
  summarizeLive,
} from "@atc/shared";
import type { Redis } from "ioredis";
import { log } from "../logger.js";

/**
 * Live order-flow engine. One worker at a time (a Redis lock) keeps Binance's public streams open
 * for the scanned coins (the 100 most traded, gold and silver):
 *  - `<coin>@kline_1m`: the forming 1-minute candle with its taker-bought volume, several times a
 *    second; closed candles extend the 4-hour history;
 *  - `!markPrice@arr@1s`: funding for every coin, every second;
 *  - `<coin>@bookTicker` for the top coins, gold and silver: best bid and ask (the spread).
 * Open interest has no stream: it is polled every 5 seconds for the top coins, gold and silver and
 * every 15 seconds for the rest (well inside Binance's request limits).
 * Every second the windows are recalculated and published on Redis for the API to push to browsers.
 */

const M1 = 60_000;
const LOCK_KEY = "liveflow:leader";
const LOCK_TTL_MS = 20_000;
const SILENT_MS = 30_000;
/** Binance allows up to 1024 streams per connection; we stay far below. */
const STREAMS_PER_SOCKET = 150;
const OI_KEEP_MS = 75 * M1;
const oiKey = (symbol: string) => `of:oi:${symbol}`;

export interface LiveFlowUrls {
  /** Routed market-data streams (klines, mark price). */
  market: string;
  /** Routed public high-frequency streams (best bid and ask). */
  public: string;
}
export const LIVE_FLOW_URLS: LiveFlowUrls = {
  market: "wss://fstream.binance.com/market/stream",
  public: "wss://fstream.binance.com/public/stream",
};

export interface LiveFlowDeps {
  db: PrismaClient;
  redis: Redis;
  config: AdapterConfig;
  urls?: LiveFlowUrls;
  WebSocketImpl?: typeof WebSocket;
  now?: () => number;
  /** Called with every tick, without holding it up (live scalp alerts, paper bots). */
  onTick?: (tick: LiveTick) => Promise<unknown> | unknown;
}

interface CoinState {
  symbol: string;
  rank: number;
  closed: DeltaCandle[];
  forming: DeltaCandle | null;
  oi: Array<{ t: number; oi: number }>;
  funding: number | null;
  bid: number | null;
  ask: number | null;
  updatedAt: number;
  seeded: boolean;
  needsSeed: boolean;
  lastOiPoll: number;
}

async function text(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (data && typeof (data as Blob).text === "function") return (data as Blob).text();
  return String(data);
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export class LiveFlowEngine {
  private readonly token = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  private readonly urls: LiveFlowUrls;
  private readonly WS: typeof WebSocket;
  private readonly now: () => number;
  private readonly coins = new Map<string, CoinState>();
  private sockets: Array<{ ws: WebSocket | null; stop: () => void }> = [];
  private socketKey = "";
  private timers: NodeJS.Timeout[] = [];
  private leader = false;
  private stopped = false;
  private ticking = false;
  private seeding = false;
  private polling = false;
  private universe = 0;
  private lastOiWarn = 0;
  /** For tests and status. */
  lastTick: LiveTick | null = null;

  constructor(private readonly deps: LiveFlowDeps) {
    this.urls = deps.urls ?? LIVE_FLOW_URLS;
    this.WS = deps.WebSocketImpl ?? WebSocket;
    this.now = deps.now ?? Date.now;
  }

  start(): { stop: () => Promise<void> } {
    const guard = (name: string, fn: () => Promise<unknown>) => () =>
      void fn().catch((err) => log.warn(`live flow ${name} failed`, { err }));
    guard("lock", () => this.leadership())();
    this.timers.push(
      setInterval(
        guard("lock", () => this.leadership()),
        LOCK_TTL_MS / 3,
      ),
    );
    this.timers.push(
      setInterval(
        guard("universe", () => this.refreshUniverse()),
        30_000,
      ),
    );
    this.timers.push(
      setInterval(
        guard("seed", () => this.seedPending()),
        5_000,
      ),
    );
    this.timers.push(
      setInterval(
        guard("open interest", () => this.pollOpenInterest()),
        1_000,
      ),
    );
    this.timers.push(
      setInterval(
        guard("tick", () => this.tick()),
        LIVE_TICK_MS,
      ),
    );
    return { stop: () => this.stop() };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.disconnect();
    if (this.leader)
      await this.deps.redis
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          LOCK_KEY,
          this.token,
        )
        .catch(() => undefined);
  }

  get isLeader(): boolean {
    return this.leader;
  }

  /** Takes or renews the lock; the holder streams. Public for tests. */
  async leadership(): Promise<void> {
    if (this.stopped) return;
    if (this.leader) {
      const ok = await this.deps.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        1,
        LOCK_KEY,
        this.token,
        LOCK_TTL_MS,
      );
      if (Number(ok) === 1) return;
      log.warn("live flow lost the lock; another worker streams now");
      this.leader = false;
      this.disconnect();
      return;
    }
    const got = await this.deps.redis.set(LOCK_KEY, this.token, "PX", LOCK_TTL_MS, "NX");
    if (got !== "OK") return;
    this.leader = true;
    log.info("live flow engine started");
    await this.refreshUniverse();
  }

  /**
   * The coins and ranks of the latest 1-minute scan. New coins are seeded from Binance's candles,
   * dropped ones forgotten, and the streams reopened when the list changed.
   */
  async refreshUniverse(): Promise<void> {
    if (!this.leader) return;
    const row = await this.deps.db.marketSnapshot.findUnique({ where: { key: SCALP_KEY } });
    const snap = row?.data as unknown as ScalpSnapshot | undefined;
    if (!snap?.coins?.length) return;
    this.universe = snap.universe;
    const wanted = new Map(snap.coins.map((c) => [c.symbol, c.rank]));
    for (const s of [...this.coins.keys()]) if (!wanted.has(s)) this.coins.delete(s);
    for (const [symbol, rank] of wanted) {
      const c = this.coins.get(symbol);
      if (c) c.rank = rank;
      else
        this.coins.set(symbol, {
          symbol,
          rank,
          closed: [],
          forming: null,
          oi: [],
          funding: snap.coins.find((x) => x.symbol === symbol)?.funding ?? null,
          bid: null,
          ask: null,
          updatedAt: 0,
          seeded: false,
          needsSeed: true,
          lastOiPoll: 0,
        });
    }
    await this.seedPending();
    const key = [...this.coins.values()]
      .map((c) => `${c.symbol}:${this.bookCoin(c) ? 1 : 0}`)
      .sort()
      .join(",");
    if (key !== this.socketKey) {
      this.socketKey = key;
      this.connect();
    }
  }

  private bookCoin(c: CoinState): boolean {
    return c.rank <= LIVE_OI_FAST_COINS || isPinned(c.symbol);
  }

  /** History for new coins and for coins whose stream skipped a minute. Public for tests. */
  async seedPending(): Promise<void> {
    if (!this.leader || this.seeding) return;
    this.seeding = true;
    try {
      const pending = [...this.coins.values()].filter((c) => c.needsSeed);
      const binance = this.deps.config.binance ?? {};
      const now = this.now();
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(6, pending.length) }, async () => {
          for (;;) {
            const c = pending[next++];
            if (!c) return;
            try {
              const [candles, oi] = await Promise.all([
                fetchBinanceDeltaCandles(binance, c.symbol, FAST_LOOKBACK_CANDLES, now, "1m"),
                this.deps.redis.zrangebyscore(oiKey(c.symbol), now - OI_KEEP_MS, "+inf"),
              ]);
              // Candles the stream already closed are newer than REST's: keep them.
              const streamed = c.closed.filter((x) => x.t > (candles.at(-1)?.t ?? 0));
              c.closed = [...candles, ...streamed].slice(-FAST_LOOKBACK_CANDLES);
              const fromRedis = oi
                .map((m) => m.split(":").map(Number))
                .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
                .map(([t, v]) => ({ t: t as number, oi: v as number }));
              c.oi = mergeOi(c.oi, fromRedis, now);
              c.needsSeed = false;
              c.seeded = true;
            } catch (err) {
              log.warn("live flow seed failed", { symbol: c.symbol, err });
            }
          }
        }),
      );
    } finally {
      this.seeding = false;
    }
  }

  /** Open interest, every 5 s for the top coins (gold, silver) and every 15 s for the rest. */
  async pollOpenInterest(): Promise<void> {
    if (!this.leader || this.polling) return;
    this.polling = true;
    try {
      const now = this.now();
      const due = [...this.coins.values()].filter(
        (c) => now - c.lastOiPoll >= (this.bookCoin(c) ? LIVE_OI_FAST_MS : LIVE_OI_SLOW_MS) - 50,
      );
      if (due.length === 0) return;
      const binance = this.deps.config.binance ?? {};
      const readings: Array<[CoinState, { t: number; oi: number }]> = [];
      let failed = 0;
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(8, due.length) }, async () => {
          for (;;) {
            const c = due[next++];
            if (!c) return;
            c.lastOiPoll = now;
            try {
              readings.push([c, await fetchBinanceOpenInterestNow(binance, c.symbol)]);
            } catch {
              failed++;
            }
          }
        }),
      );
      // One summary a minute at most, so a Binance hiccup does not flood the logs.
      if (failed > 0 && now - this.lastOiWarn > M1) {
        this.lastOiWarn = now;
        log.warn("live open interest partly unavailable", { failed, of: due.length });
      }
      if (readings.length === 0) return;
      const multi = this.deps.redis.multi();
      for (const [c, r] of readings) {
        c.oi = mergeOi(c.oi, [r], now);
        // Shared with the 1-minute scan, so its open-interest windows get finer too.
        multi.zadd(oiKey(c.symbol), r.t, `${r.t}:${r.oi}`);
        multi.zremrangebyscore(oiKey(c.symbol), "-inf", now - OI_KEEP_MS);
        multi.pexpire(oiKey(c.symbol), 2 * OI_KEEP_MS);
      }
      await multi.exec();
    } finally {
      this.polling = false;
    }
  }

  private disconnect(): void {
    for (const s of this.sockets) s.stop();
    this.sockets = [];
    this.socketKey = "";
  }

  private connect(): void {
    for (const s of this.sockets) s.stop();
    this.sockets = [];
    const coins = [...this.coins.values()];
    const klines = coins.map((c) => `${c.symbol.toLowerCase()}@kline_1m`);
    const groups: Array<{ url: string; streams: string[] }> = [];
    for (let i = 0; i < klines.length; i += STREAMS_PER_SOCKET)
      groups.push({ url: this.urls.market, streams: klines.slice(i, i + STREAMS_PER_SOCKET) });
    groups.push({ url: this.urls.market, streams: ["!markPrice@arr@1s"] });
    const books = coins
      .filter((c) => this.bookCoin(c))
      .map((c) => `${c.symbol.toLowerCase()}@bookTicker`);
    if (books.length) groups.push({ url: this.urls.public, streams: books });
    for (const g of groups) this.sockets.push(this.open(`${g.url}?streams=${g.streams.join("/")}`));
  }

  private open(url: string): { ws: WebSocket | null; stop: () => void } {
    let attempt = 0;
    let stopped = false;
    let silent: NodeJS.Timeout | null = null;
    let retry: NodeJS.Timeout | null = null;
    const entry = {
      ws: null as WebSocket | null,
      stop: () => {
        stopped = true;
        if (silent) clearTimeout(silent);
        if (retry) clearTimeout(retry);
        entry.ws?.close();
      },
    };
    const bump = () => {
      if (silent) clearTimeout(silent);
      silent = setTimeout(() => {
        log.warn("live flow stream silent, reconnecting", { url: url.slice(0, 80) });
        entry.ws?.close();
      }, SILENT_MS);
    };
    const go = () => {
      if (stopped || !this.leader) return;
      const ws = new this.WS(url);
      entry.ws = ws;
      ws.addEventListener("open", () => {
        attempt = 0;
        bump();
      });
      ws.addEventListener("message", async (ev) => {
        bump();
        try {
          this.ingest(JSON.parse(await text(ev.data)));
        } catch {
          // ignore malformed messages
        }
      });
      ws.addEventListener("close", () => {
        if (silent) clearTimeout(silent);
        if (stopped || !this.leader) return;
        // Minutes missed while disconnected are filled from REST on the next seed pass.
        for (const c of this.coins.values()) c.needsSeed = true;
        retry = setTimeout(go, Math.min(30_000, 1_000 * 2 ** attempt++));
      });
      ws.addEventListener("error", () => ws.close());
    };
    go();
    return entry;
  }

  /** One stream message (combined-stream envelope). Public for tests. */
  ingest(msg: unknown): void {
    const env = msg as { stream?: string; data?: unknown };
    const data = env?.data ?? msg;
    if (Array.isArray(data)) {
      // Mark price for every coin: funding.
      for (const m of data as Array<{ s?: string; r?: string; E?: number }>) {
        const c = m?.s ? this.coins.get(m.s) : undefined;
        const r = num(m?.r);
        if (c && r !== null) c.funding = r;
      }
      return;
    }
    const d = data as Record<string, unknown>;
    if (d?.e === "kline") this.onKline(d);
    else if (d?.e === "bookTicker" || ("b" in d && "a" in d && "s" in d && !("e" in d))) {
      const c = this.coins.get(String(d.s));
      const bid = num(d.b);
      const ask = num(d.a);
      if (c && bid !== null && ask !== null && bid > 0 && ask >= bid) {
        c.bid = bid;
        c.ask = ask;
      }
    }
  }

  private onKline(d: Record<string, unknown>): void {
    const k = d.k as Record<string, unknown> | undefined;
    const c = k ? this.coins.get(String(k.s ?? d.s)) : undefined;
    if (!k || !c) return;
    const t = num(k.t);
    const o = num(k.o);
    const h = num(k.h);
    const l = num(k.l);
    const close = num(k.c);
    const base = num(k.v);
    const quote = num(k.q);
    const tbq = num(k.Q);
    if (
      t === null ||
      o === null ||
      h === null ||
      l === null ||
      close === null ||
      base === null ||
      quote === null ||
      tbq === null
    )
      return;
    const candle: DeltaCandle = { t, o, h, l, c: close, base, quote, takerBuyQuote: tbq };
    c.updatedAt = Math.max(c.updatedAt, num(d.E) ?? this.now());
    const last = c.closed.at(-1);
    if (k.x === true) {
      if (last && t === last.t) c.closed[c.closed.length - 1] = candle;
      else if (!last || t > last.t) {
        // A skipped minute means the history has a hole: refill it from REST.
        if (last && t - last.t !== M1) c.needsSeed = true;
        c.closed.push(candle);
        if (c.closed.length > FAST_LOOKBACK_CANDLES + 5)
          c.closed.splice(0, c.closed.length - FAST_LOOKBACK_CANDLES);
      }
      if (c.forming && c.forming.t <= t) c.forming = null;
      return;
    }
    if (last && t <= last.t) return;
    // The stream moved to a new minute without the closing update of the previous one.
    if (c.forming && t > c.forming.t) c.needsSeed = true;
    c.forming = candle;
  }

  /** Computes and publishes one tick. Public for tests. */
  async tick(): Promise<LiveTick | null> {
    if (!this.leader || this.ticking) return null;
    this.ticking = true;
    try {
      const now = this.now();
      const out: LiveCoin[] = [];
      for (const c of this.coins.values()) {
        if (!c.seeded) continue;
        const spread =
          c.bid !== null && c.ask !== null
            ? ((c.ask - c.bid) / ((c.ask + c.bid) / 2)) * 10_000
            : null;
        const live = liveCoin({
          symbol: c.symbol,
          rank: c.rank,
          closed: c.closed,
          forming: c.forming,
          oi: c.oi,
          funding: c.funding,
          spreadBps: spread,
          updatedAt: c.updatedAt,
          now,
          series: LIVE_SERIES_POINTS,
        });
        if (live) out.push(live);
      }
      if (out.length === 0) return null;
      out.sort((a, b) => a.r - b.r);
      const tick: LiveTick = {
        at: now,
        universe: this.universe,
        coins: out,
        summary: summarizeLive(out),
      };
      this.lastTick = tick;
      const json = JSON.stringify(tick, (_k, v) =>
        typeof v === "number" && !Number.isInteger(v) ? Number(v.toPrecision(10)) : v,
      );
      await Promise.all([
        this.deps.redis.set(LIVE_FLOW_KEY, json, "PX", 15_000),
        this.deps.redis.set(LIVE_ALIVE_KEY, "1", "PX", 5_000),
        this.deps.redis.publish(LIVE_FLOW_CHANNEL, json),
      ]);
      // Alerts and paper bots run beside the feed (each skips a tick while still busy), so a slow
      // database never holds back the next second's figures.
      void Promise.resolve()
        .then(() => this.deps.onTick?.(tick))
        .catch(() => undefined);
      return tick;
    } finally {
      this.ticking = false;
    }
  }

  /** For tests: the engine's view of one coin. */
  state(symbol: string): Readonly<CoinState> | undefined {
    return this.coins.get(symbol);
  }
}

/** Readings merged by time, the newest kept, older than 75 minutes dropped. */
function mergeOi(
  a: ReadonlyArray<{ t: number; oi: number }>,
  b: ReadonlyArray<{ t: number; oi: number }>,
  now: number,
): Array<{ t: number; oi: number }> {
  const by = new Map<number, number>();
  for (const p of [...a, ...b]) if (p.oi > 0 && p.t >= now - OI_KEEP_MS) by.set(p.t, p.oi);
  return [...by].map(([t, oi]) => ({ t, oi })).sort((x, y) => x.t - y.t);
}

export function startLiveFlow(deps: LiveFlowDeps): { stop: () => Promise<void> } {
  return new LiveFlowEngine(deps).start();
}
