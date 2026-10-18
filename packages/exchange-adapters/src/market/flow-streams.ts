import { FLOW_SYMBOLS, type FlowExchange, type FlowSymbol, WHALE_MIN_USD } from "@atc/shared";

/**
 * Parsers for the public trade and liquidation streams of Binance, Bybit and OKX, normalised to
 * one shape, plus the taker-order grouping used to find whale trades. Pure functions: the live
 * connections live in the worker.
 */

export interface TradeTick {
  exchange: FlowExchange;
  symbol: FlowSymbol;
  ts: number;
  /** Taker side: "buy" = the aggressive order bought. */
  side: "buy" | "sell";
  price: number;
  /** Base-coin quantity. */
  qty: number;
}

export interface LiquidationEvent {
  exchange: FlowExchange;
  symbol: FlowSymbol;
  ts: number;
  /** The position that was force-closed. */
  side: "long" | "short";
  price: number;
  qty: number;
  usd: number;
}

export interface WhaleOrder {
  exchange: FlowExchange;
  symbol: FlowSymbol;
  ts: number;
  side: "buy" | "sell";
  /** Volume-weighted average price of the order's fills. */
  price: number;
  qty: number;
  usd: number;
  fills: number;
}

const TRACKED: ReadonlySet<string> = new Set(FLOW_SYMBOLS);
const tracked = (s: string): FlowSymbol | null => (TRACKED.has(s) ? (s as FlowSymbol) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const positive = (v: unknown) => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};

/** "BTC-USDT-SWAP" → "BTCUSDT". */
export const okxSymbol = (instId: string) =>
  instId.endsWith("-USDT-SWAP") ? `${instId.slice(0, -"-USDT-SWAP".length)}USDT` : null;

// ─── Binance (USDⓈ-M futures, /market/stream) ───

export function parseBinance(msg: unknown): {
  trades: TradeTick[];
  liquidations: LiquidationEvent[];
} {
  const out = { trades: [] as TradeTick[], liquidations: [] as LiquidationEvent[] };
  const data = (msg as { data?: unknown } | null)?.data ?? msg;
  for (const d of Array.isArray(data) ? data : [data]) {
    const e = d as Record<string, unknown> | null;
    if (!e) continue;
    if (e.e === "aggTrade") {
      const symbol = tracked(String(e.s));
      const price = positive(e.p);
      const qty = positive(e.q);
      const ts = num(e.T);
      if (!symbol || !price || !qty || ts === null) continue;
      // m = buyer is the maker, so the taker sold.
      out.trades.push({ exchange: "BINANCE", symbol, ts, side: e.m ? "sell" : "buy", price, qty });
    } else if (e.e === "forceOrder") {
      const o = e.o as Record<string, unknown> | undefined;
      const symbol = tracked(String(o?.s));
      const price = positive(o?.ap) ?? positive(o?.p);
      const qty = positive(o?.z) ?? positive(o?.q);
      const ts = num(o?.T);
      if (!o || !symbol || !price || !qty || ts === null) continue;
      // The liquidation order SELLs a long position and BUYs back a short one.
      out.liquidations.push({
        exchange: "BINANCE",
        symbol,
        ts,
        side: o.S === "SELL" ? "long" : "short",
        price,
        qty,
        usd: price * qty,
      });
    }
  }
  return out;
}

// ─── Bybit (v5 public linear) ───

export function parseBybit(msg: unknown): {
  trades: TradeTick[];
  liquidations: LiquidationEvent[];
} {
  const out = { trades: [] as TradeTick[], liquidations: [] as LiquidationEvent[] };
  const m = msg as { topic?: string; data?: unknown } | null;
  const topic = m?.topic ?? "";
  const rows = Array.isArray(m?.data) ? (m?.data as Record<string, unknown>[]) : [];
  for (const r of rows) {
    const symbol = tracked(String(r.s));
    const price = positive(r.p);
    const qty = positive(r.v);
    const ts = num(r.T);
    if (!symbol || !price || !qty || ts === null) continue;
    if (topic.startsWith("publicTrade.")) {
      // S is the taker side.
      out.trades.push({
        exchange: "BYBIT",
        symbol,
        ts,
        side: r.S === "Sell" ? "sell" : "buy",
        price,
        qty,
      });
    } else if (topic.startsWith("allLiquidation.")) {
      // S is the liquidated position's side: "Buy" = a long was liquidated.
      out.liquidations.push({
        exchange: "BYBIT",
        symbol,
        ts,
        side: r.S === "Buy" ? "long" : "short",
        price,
        qty,
        usd: price * qty,
      });
    }
  }
  return out;
}

// ─── OKX (v5 public) ───

/**
 * `ctVal` maps instId → contract value in coins (sizes are in contracts). An instrument without a
 * known contract value is skipped rather than guessed.
 */
export function parseOkx(
  msg: unknown,
  ctVal: ReadonlyMap<string, number>,
): { trades: TradeTick[]; liquidations: LiquidationEvent[] } {
  const out = { trades: [] as TradeTick[], liquidations: [] as LiquidationEvent[] };
  const m = msg as { arg?: { channel?: string }; data?: unknown } | null;
  const channel = m?.arg?.channel;
  const rows = Array.isArray(m?.data) ? (m?.data as Record<string, unknown>[]) : [];
  for (const r of rows) {
    const instId = String(r.instId ?? "");
    const symbol = tracked(okxSymbol(instId) ?? "");
    const cv = ctVal.get(instId);
    if (!symbol || !cv) continue;
    if (channel === "trades") {
      const price = positive(r.px);
      const contracts = positive(r.sz);
      const ts = num(r.ts);
      if (!price || !contracts || ts === null) continue;
      out.trades.push({
        exchange: "OKX",
        symbol,
        ts,
        side: r.side === "sell" ? "sell" : "buy",
        price,
        qty: contracts * cv,
      });
    } else if (channel === "liquidation-orders") {
      const details = Array.isArray(r.details) ? (r.details as Record<string, unknown>[]) : [];
      for (const d of details) {
        const price = positive(d.bkPx);
        const contracts = positive(d.sz);
        const ts = num(d.ts);
        if (!price || !contracts || ts === null) continue;
        // posSide names the liquidated position; in net mode a SELL closes a long.
        const side =
          d.posSide === "long" || d.posSide === "short"
            ? d.posSide
            : d.side === "sell"
              ? "long"
              : "short";
        const qty = contracts * cv;
        out.liquidations.push({ exchange: "OKX", symbol, ts, side, price, qty, usd: price * qty });
      }
    }
  }
  return out;
}

// ─── Taker orders → whale trades ───

interface Group {
  key: string;
  first: TradeTick;
  qty: number;
  notional: number;
  fills: number;
  openedAt: number;
}

/**
 * Adds up the fills of one market order. Exchanges report a large market order as several fills
 * at different prices, all with the same taker side and the same timestamp; consecutive fills with
 * the same side and millisecond on the same market are one order. An order is complete when a
 * different one arrives on that market, or after `idleMs` without more fills.
 */
export class TakerOrderGrouper {
  private readonly open = new Map<string, Group>();

  constructor(
    private readonly minUsd: (symbol: FlowSymbol) => number = (s) => WHALE_MIN_USD[s],
    private readonly idleMs = 300,
  ) {}

  /** Adds a fill; returns any whale orders it completed. `now` is the receive time. */
  push(t: TradeTick, now = Date.now()): WhaleOrder[] {
    const market = `${t.exchange}|${t.symbol}`;
    const key = `${t.side}|${t.ts}`;
    const g = this.open.get(market);
    if (g && g.key === key) {
      g.qty += t.qty;
      g.notional += t.qty * t.price;
      g.fills += 1;
      return [];
    }
    const done = g ? this.close(g) : [];
    this.open.set(market, {
      key,
      first: t,
      qty: t.qty,
      notional: t.qty * t.price,
      fills: 1,
      openedAt: now,
    });
    return done;
  }

  /** Completes orders that have had no fill for `idleMs`. */
  flush(now = Date.now(), all = false): WhaleOrder[] {
    const out: WhaleOrder[] = [];
    for (const [market, g] of this.open) {
      if (all || now - g.openedAt >= this.idleMs) {
        this.open.delete(market);
        out.push(...this.close(g));
      }
    }
    return out;
  }

  private close(g: Group): WhaleOrder[] {
    if (g.notional < this.minUsd(g.first.symbol)) return [];
    return [
      {
        exchange: g.first.exchange,
        symbol: g.first.symbol,
        ts: g.first.ts,
        side: g.first.side,
        price: g.notional / g.qty,
        qty: g.qty,
        usd: g.notional,
        fills: g.fills,
      },
    ];
  }
}
