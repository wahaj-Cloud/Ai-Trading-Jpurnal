import type { Prisma, PrismaClient } from "@atc/db";
import { writeSnapshot } from "@atc/db";
import {
  type LiquidationEvent,
  okxInstrument,
  parseBinance,
  parseBybit,
  parseOkx,
  TakerOrderGrouper,
  type TradeTick,
  type WhaleOrder,
} from "@atc/exchange-adapters";
import {
  FLOW_EXCHANGES,
  FLOW_RETENTION_DAYS,
  FLOW_STATUS_KEY,
  FLOW_SYMBOLS,
  type FlowExchange,
  type FlowStatus,
} from "@atc/shared";
import { log } from "../logger.js";

/**
 * Market Flow collector: keeps one public WebSocket per exchange (Binance, Bybit, OKX) open for the
 * tracked markets, turns trades into whale orders and stores them with real liquidations.
 *
 * Only one worker collects at a time (a Redis lock), so scaling the worker never double-counts.
 * Every connection reconnects with backoff and is restarted if it goes silent.
 */

const DAY = 86_400_000;
const SILENT_MS = 60_000;
const FLUSH_MS = 2_000;
const LOCK_KEY = "flow:leader";
const LOCK_TTL_MS = 30_000;

export interface FlowUrls {
  binance: string;
  bybit: string;
  okx: string;
  okxRest: string;
}
export const FLOW_URLS: FlowUrls = {
  binance: "wss://fstream.binance.com/market/stream",
  bybit: "wss://stream.bybit.com/v5/public/linear",
  okx: "wss://ws.okx.com:8443/ws/v5/public",
  okxRest: "https://www.okx.com",
};

export interface LockStore {
  set(key: string, value: string, px: "PX", ttl: number, nx: "NX"): Promise<string | null>;
  eval(script: string, keys: number, ...args: (string | number)[]): Promise<unknown>;
}

export interface FlowCollectorDeps {
  db: PrismaClient;
  redis: LockStore;
  urls?: FlowUrls;
  WebSocketImpl?: typeof WebSocket;
  fetchFn?: typeof fetch;
  now?: () => number;
}

/** Text of a WebSocket message (string, ArrayBuffer or Blob). */
async function text(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (data && typeof (data as Blob).text === "function") return (data as Blob).text();
  return String(data);
}

interface Feed {
  exchange: FlowExchange;
  url: () => string;
  /** Messages to send once connected (subscriptions). */
  subscribe: () => string[];
  /** Application-level keep-alive, when the exchange needs one. */
  ping?: { everyMs: number; message: string };
  parse: (msg: unknown) => { trades: TradeTick[]; liquidations: LiquidationEvent[] };
}

export class FlowCollector {
  private readonly token = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  private readonly urls: FlowUrls;
  private readonly WS: typeof WebSocket;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly grouper = new TakerOrderGrouper();
  private readonly sockets = new Map<FlowExchange, { ws: WebSocket | null; stop: () => void }>();
  private readonly status: FlowStatus["exchanges"];
  private okxCtVal = new Map<string, number>();
  private whales: WhaleOrder[] = [];
  private liquidations: LiquidationEvent[] = [];
  private timers: NodeJS.Timeout[] = [];
  private leader = false;
  private stopped = false;
  private since = new Date();

  constructor(private readonly deps: FlowCollectorDeps) {
    this.urls = deps.urls ?? FLOW_URLS;
    this.WS = deps.WebSocketImpl ?? WebSocket;
    this.fetchFn = deps.fetchFn ?? fetch;
    this.now = deps.now ?? Date.now;
    this.status = Object.fromEntries(
      FLOW_EXCHANGES.map((e) => [e, { connected: false, lastEventAt: null }]),
    ) as FlowStatus["exchanges"];
  }

  /** Starts competing for the lock; the holder collects. */
  start(): { stop: () => Promise<void> } {
    const tick = () => void this.leadership().catch((err) => log.warn("flow lock failed", { err }));
    tick();
    this.timers.push(setInterval(tick, LOCK_TTL_MS / 3));
    this.timers.push(setInterval(() => this.collectIdle(), 250));
    this.timers.push(setInterval(() => void this.flush(), FLUSH_MS));
    this.timers.push(setInterval(() => void this.saveStatus(), 15_000));
    this.timers.push(setInterval(() => void this.cleanup(), 60 * 60_000));
    return { stop: () => this.stop() };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.disconnectAll();
    this.whales.push(...this.grouper.flush(this.now(), true));
    await this.flush();
    if (this.leader) {
      await this.deps.redis
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          LOCK_KEY,
          this.token,
        )
        .catch(() => undefined);
    }
  }

  private async leadership(): Promise<void> {
    if (this.stopped) return;
    if (this.leader) {
      const renewed = await this.deps.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        1,
        LOCK_KEY,
        this.token,
        LOCK_TTL_MS,
      );
      if (Number(renewed) === 1) return;
      log.warn("flow collector lost the lock; another worker collects now");
      this.leader = false;
      this.disconnectAll();
      return;
    }
    const got = await this.deps.redis.set(LOCK_KEY, this.token, "PX", LOCK_TTL_MS, "NX");
    if (got !== "OK") return;
    this.leader = true;
    this.since = new Date(this.now());
    log.info("flow collector started");
    await this.loadOkxContracts();
    for (const feed of this.feeds()) this.connect(feed);
  }

  /** OKX sizes are in contracts: the contract value of each tracked swap, from OKX's public list. */
  private async loadOkxContracts(): Promise<void> {
    try {
      const res = await this.fetchFn(
        `${this.urls.okxRest}/api/v5/public/instruments?instType=SWAP`,
        { signal: AbortSignal.timeout(15_000) },
      );
      const json = (await res.json()) as {
        data?: { instId: string; ctVal: string; ctType?: string; settleCcy?: string }[];
      };
      const wanted = new Set(FLOW_SYMBOLS.map(okxInstrument));
      const map = new Map<string, number>();
      for (const i of json.data ?? []) {
        const v = Number(i.ctVal);
        if (wanted.has(i.instId) && i.ctType !== "inverse" && Number.isFinite(v) && v > 0)
          map.set(i.instId, v);
      }
      this.okxCtVal = map;
    } catch (err) {
      log.warn("OKX contract sizes unavailable; OKX feed skipped until the next restart", {
        err: (err as Error).message,
      });
    }
  }

  private feeds(): Feed[] {
    const lower = FLOW_SYMBOLS.map((s) => s.toLowerCase());
    return [
      {
        exchange: "BINANCE",
        url: () =>
          `${this.urls.binance}?streams=${[...lower.map((s) => `${s}@aggTrade`), "!forceOrder@arr"].join("/")}`,
        subscribe: () => [],
        parse: parseBinance,
      },
      {
        exchange: "BYBIT",
        url: () => this.urls.bybit,
        // One topic per request: a market Bybit does not list must not fail the others.
        subscribe: () =>
          FLOW_SYMBOLS.flatMap((s) => [
            JSON.stringify({ op: "subscribe", args: [`publicTrade.${s}`] }),
            JSON.stringify({ op: "subscribe", args: [`allLiquidation.${s}`] }),
          ]),
        ping: { everyMs: 20_000, message: JSON.stringify({ op: "ping" }) },
        parse: parseBybit,
      },
      {
        exchange: "OKX",
        url: () => this.urls.okx,
        subscribe: () =>
          this.okxCtVal.size === 0
            ? []
            : [
                ...[...this.okxCtVal.keys()].map((instId) =>
                  JSON.stringify({ op: "subscribe", args: [{ channel: "trades", instId }] }),
                ),
                JSON.stringify({
                  op: "subscribe",
                  args: [{ channel: "liquidation-orders", instType: "SWAP" }],
                }),
              ],
        ping: { everyMs: 25_000, message: "ping" },
        parse: (m) => parseOkx(m, this.okxCtVal),
      },
    ];
  }

  private connect(feed: Feed): void {
    let attempt = 0;
    let stopped = false;
    let silent: NodeJS.Timeout | null = null;
    let ping: NodeJS.Timeout | null = null;
    let retry: NodeJS.Timeout | null = null;
    const entry = {
      ws: null as WebSocket | null,
      stop: () => {
        stopped = true;
        if (silent) clearTimeout(silent);
        if (ping) clearInterval(ping);
        if (retry) clearTimeout(retry);
        entry.ws?.close();
        this.status[feed.exchange].connected = false;
      },
    };
    this.sockets.get(feed.exchange)?.stop();
    this.sockets.set(feed.exchange, entry);

    const bump = () => {
      if (silent) clearTimeout(silent);
      silent = setTimeout(() => {
        log.warn("flow feed silent, reconnecting", { exchange: feed.exchange });
        entry.ws?.close();
      }, SILENT_MS);
    };
    const open = () => {
      if (stopped || !this.leader) return;
      const ws = new this.WS(feed.url());
      entry.ws = ws;
      ws.addEventListener("open", () => {
        attempt = 0;
        this.status[feed.exchange].connected = true;
        bump();
        for (const m of feed.subscribe()) ws.send(m);
        if (feed.ping) {
          const msg = feed.ping.message;
          ping = setInterval(() => {
            if (ws.readyState === ws.OPEN) ws.send(msg);
          }, feed.ping.everyMs);
        }
      });
      ws.addEventListener("message", async (ev) => {
        bump();
        let parsed: unknown;
        try {
          const raw = await text(ev.data);
          if (raw === "pong") return;
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        this.ingest(feed.exchange, feed.parse(parsed));
      });
      ws.addEventListener("close", () => {
        this.status[feed.exchange].connected = false;
        if (ping) clearInterval(ping);
        if (silent) clearTimeout(silent);
        if (stopped || !this.leader) return;
        const delay = Math.min(60_000, 1_000 * 2 ** attempt++);
        retry = setTimeout(open, delay);
      });
      ws.addEventListener("error", () => ws.close());
    };
    open();
  }

  private disconnectAll(): void {
    for (const s of this.sockets.values()) s.stop();
    this.sockets.clear();
  }

  /** Public for tests: feeds parsed events in. */
  ingest(
    exchange: FlowExchange,
    events: { trades: TradeTick[]; liquidations: LiquidationEvent[] },
  ): void {
    const now = this.now();
    for (const t of events.trades) this.whales.push(...this.grouper.push(t, now));
    this.liquidations.push(...events.liquidations);
    if (events.trades.length || events.liquidations.length)
      this.status[exchange].lastEventAt = new Date(now).toISOString();
  }

  collectIdle(): void {
    this.whales.push(...this.grouper.flush(this.now()));
  }

  /** Writes what has been collected (also used by tests). */
  async flush(): Promise<{ whales: number; liquidations: number }> {
    const whales = this.whales.splice(0);
    const liqs = this.liquidations.splice(0);
    const d = (n: number, dp: number) => n.toFixed(dp);
    try {
      if (whales.length)
        await this.deps.db.whaleTrade.createMany({
          data: whales.map(
            (w): Prisma.WhaleTradeCreateManyInput => ({
              exchange: w.exchange,
              symbol: w.symbol,
              side: w.side,
              price: d(w.price, 10),
              qty: d(w.qty, 10),
              usd: d(w.usd, 2),
              fills: w.fills,
              at: new Date(w.ts),
            }),
          ),
        });
      if (liqs.length)
        await this.deps.db.liquidationEvent.createMany({
          data: liqs.map(
            (l): Prisma.LiquidationEventCreateManyInput => ({
              exchange: l.exchange,
              symbol: l.symbol,
              side: l.side,
              price: d(l.price, 10),
              qty: d(l.qty, 10),
              usd: d(l.usd, 2),
              at: new Date(l.ts),
            }),
          ),
        });
    } catch (err) {
      // Keep the batch for the next try rather than losing it (bounded so memory stays small).
      this.whales.unshift(...whales.slice(-5_000));
      this.liquidations.unshift(...liqs.slice(-5_000));
      log.warn("flow write failed, retrying", { err: (err as Error).message });
      return { whales: 0, liquidations: 0 };
    }
    return { whales: whales.length, liquidations: liqs.length };
  }

  async saveStatus(): Promise<void> {
    if (!this.leader) return;
    const data: FlowStatus = {
      since: this.since.toISOString(),
      updatedAt: new Date(this.now()).toISOString(),
      exchanges: this.status,
    };
    const json = data as unknown as Prisma.InputJsonValue;
    await writeSnapshot(this.deps.db, FLOW_STATUS_KEY, json, new Date(this.now())).catch((err) =>
      log.warn("flow status save failed", { err: (err as Error).message }),
    );
  }

  async cleanup(): Promise<void> {
    if (!this.leader) return;
    const before = new Date(this.now() - FLOW_RETENTION_DAYS * DAY);
    await this.deps.db.whaleTrade
      .deleteMany({ where: { at: { lt: before } } })
      .catch(() => undefined);
    await this.deps.db.liquidationEvent
      .deleteMany({ where: { at: { lt: before } } })
      .catch(() => undefined);
  }

  /** For tests. */
  get isLeader(): boolean {
    return this.leader;
  }
  async tickLeadership(): Promise<void> {
    await this.leadership();
  }
}

export function startFlowCollector(deps: FlowCollectorDeps): { stop: () => Promise<void> } {
  return new FlowCollector(deps).start();
}
