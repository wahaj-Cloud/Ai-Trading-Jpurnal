import { dec, type ExchangePositionRecord, str } from "@atc/trade-engine";
import { num, positive, signed } from "../history/snapshot.js";
import {
  DAY_MS,
  type HistoryBatch,
  type HistorySource,
  type HistoryWindow,
  type NormalizedFill,
  type NormalizedIncome,
  type OpenPositionSnapshot,
} from "../history/types.js";
import { canonicalSymbol } from "../symbols.js";
import type { ApiCredentials, VerificationFailure } from "../types.js";
import { mapBinanceFailure } from "./adapter.js";
import { BinanceClient, type BinanceClientOptions } from "./client.js";

const PAGE = 1000;
const MINUTE_MS = 60_000;
const KLINE_LIMIT = 1000;
/** Marks a fee paid in another asset until it is converted (never stored). */
const PENDING_CONVERSION = "pending-conversion";
/** /fapi/v1/userTrades rejects ranges longer than 7 days. */
const MAX_WINDOW_MS = 7 * DAY_MS - 1_000;
/** Trades and income are kept for about 3 months; stay a little inside that. */
const RETENTION_MS = 88 * DAY_MS;

interface BinanceTrade {
  id: number;
  orderId: number;
  symbol: string;
  side: "BUY" | "SELL";
  positionSide: "LONG" | "SHORT" | "BOTH";
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  realizedPnl: string;
  maker: boolean;
  time: number;
}

interface BinanceIncome {
  symbol: string;
  incomeType: string;
  income: string;
  asset: string;
  time: number;
  tranId: number | string;
  tradeId?: string;
}

/** /fapi/v3/positionRisk row (v3 no longer reports leverage or margin type directly). */
interface BinancePositionRisk {
  symbol: string;
  positionSide: "LONG" | "SHORT" | "BOTH";
  positionAmt: string;
  entryPrice?: string;
  markPrice?: string;
  unRealizedProfit?: string;
  liquidationPrice?: string;
  notional?: string;
  initialMargin?: string;
  /** Margin for the position alone (initialMargin also includes open orders). */
  positionInitialMargin?: string;
  isolatedWallet?: string;
}

type IncomeRow = { symbol: string | null; normalized: NormalizedIncome };

const INCOME_TYPES: Record<string, NormalizedIncome["type"]> = {
  FUNDING_FEE: "FUNDING",
  COMMISSION: "COMMISSION",
  REALIZED_PNL: "REALIZED_PNL",
};

/**
 * Binance USDⓈ-M: complete fills (with side, position side and the exchange's realised PnL),
 * so our engine rebuilds positions. userTrades needs a symbol, so traded symbols are discovered from
 * the income ledger (every trade books a commission or realised-PnL line) plus open positions.
 */
export class BinanceHistorySource implements HistorySource {
  readonly model = "FILLS" as const;
  readonly maxWindowMs = MAX_WINDOW_MS;
  readonly retentionMs = RETENTION_MS;
  private readonly client: BinanceClient;

  constructor(credentials: ApiCredentials, options: BinanceClientOptions = {}) {
    this.client = new BinanceClient(credentials, options);
  }

  async fetchHistory({ since, until }: HistoryWindow): Promise<HistoryBatch> {
    const start = since.getTime();
    const end = until.getTime();
    const run = await this.discover(start, end);
    const income = run.income.filter((i) => {
      const t = i.normalized.occurredAt.getTime();
      return t >= start && t <= end;
    });
    // Every symbol traded anywhere in this sync run is checked in every window: a trade opened
    // with a zero-fee fill (no income line) in one window and closed in the next is still found.
    const symbols = run.symbols;

    const fills: NormalizedFill[] = [];
    for (const native of [...symbols].sort()) {
      fills.push(...(await this.fetchTrades(native, start, end)));
    }
    await this.convertFees(fills);
    return { fills, income: income.map((i) => i.normalized), positions: [] };
  }

  /**
   * Fees paid in another asset (BNB fee discount) are converted to the trade's quote currency at
   * that minute's price, so net PnL and fee statistics stay right. The original amount and asset
   * stay on the fill's raw record. If no price can be found the fee is stored as 0 with its original
   * asset, so the gap stays visible.
   */
  private async convertFees(fills: NormalizedFill[]): Promise<void> {
    const pending = fills.filter((f) => f.fee === PENDING_CONVERSION);
    const groups = new Map<string, NormalizedFill[]>();
    for (const f of pending) {
      const quote = canonicalSymbol("BINANCE", (f.raw as BinanceTrade).symbol).quote;
      const pair = `${f.feeAsset}${quote}`;
      groups.set(pair, [...(groups.get(pair) ?? []), f]);
    }
    for (const [pair, list] of groups) {
      const prices = await this.minutePrices(
        pair,
        list.map((f) => f.executedAt.getTime()),
      );
      for (const f of list) {
        const t = f.raw as BinanceTrade;
        const price = prices.get(Math.floor(t.time / MINUTE_MS) * MINUTE_MS);
        f.fee = price ? str(dec(t.commission).times(price)) : "0";
        // The stored fee is now in the quote currency; the original asset stays in raw.
        if (price) f.feeAsset = canonicalSymbol("BINANCE", t.symbol).quote;
        f.raw = { ...t, feeConversion: price ? { pair, price } : { pair, price: null } };
      }
    }
  }

  /** 1-minute closes covering the given times (futures market first, then spot). */
  private async minutePrices(pair: string, times: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    const minutes = [...new Set(times.map((t) => Math.floor(t / MINUTE_MS) * MINUTE_MS))].sort(
      (a, b) => a - b,
    );
    for (const market of ["futures", "spot"] as const) {
      const missing = minutes.filter((m) => !out.has(m));
      for (let i = 0; i < missing.length; ) {
        const from = missing[i] as number;
        const path = market === "futures" ? "/fapi/v1/klines" : "/api/v3/klines";
        const rows = await this.client
          .publicGet<[number, string, string, string, string][]>(market, path, {
            symbol: pair,
            interval: "1m",
            startTime: from,
            limit: KLINE_LIMIT,
          })
          .catch(() => null);
        if (!rows) break; // pair not listed on this market
        for (const r of rows) out.set(r[0], r[4]);
        const covered = from + KLINE_LIMIT * MINUTE_MS;
        while (i < missing.length && (missing[i] as number) < covered) i++;
      }
      if (minutes.every((m) => out.has(m))) break;
    }
    return out;
  }

  toRecords(): ExchangePositionRecord[] {
    return []; // positions come from fills
  }

  async fetchOpenPositions(): Promise<OpenPositionSnapshot[]> {
    return (await this.positionRisk()).map(toSnapshot);
  }

  classify(err: unknown): VerificationFailure {
    return mapBinanceFailure(err, "account");
  }

  private run: { from: number; to: number; income: IncomeRow[]; symbols: Set<string> } | null =
    null;

  /**
   * First call of a sync run: reads the income ledger for the whole remaining range (in the same
   * 7-day windows) and the open positions once. Later windows reuse it, so a backfill costs no
   * extra requests.
   */
  private async discover(start: number, end: number) {
    if (this.run && start >= this.run.from && end <= this.run.to) return this.run;
    const to = Math.max(end, this.client.nowMs());
    const byId = new Map<string, IncomeRow>();
    for (let from = start; from < to; from += MAX_WINDOW_MS) {
      // Range ends are inclusive: a record on a boundary comes back twice and is kept once.
      for (const row of await this.fetchIncome(from, Math.min(from + MAX_WINDOW_MS, to)))
        byId.set(row.normalized.externalId, row);
    }
    const income = [...byId.values()];
    const symbols = new Set(income.map((i) => i.symbol).filter((s): s is string => s !== null));
    for (const s of await this.openPositionSymbols()) symbols.add(s);
    this.run = { from: start, to, income, symbols };
    return this.run;
  }

  private async fetchIncome(start: number, end: number): Promise<IncomeRow[]> {
    const out: IncomeRow[] = [];
    for (let page = 1; ; page++) {
      const rows = await this.client.signedGet<BinanceIncome[]>("futures", "/fapi/v1/income", {
        startTime: start,
        endTime: end,
        limit: PAGE,
        page,
      });
      for (const r of rows) {
        const native = r.symbol || null;
        out.push({
          symbol: native,
          normalized: {
            externalId: `${r.incomeType}:${r.tranId}:${r.tradeId ?? ""}:${r.symbol ?? ""}`,
            type: INCOME_TYPES[r.incomeType] ?? "OTHER",
            amount: r.income,
            asset: r.asset,
            symbol: native ? canonicalSymbol("BINANCE", native).symbol : null,
            occurredAt: new Date(r.time),
            raw: r,
          },
        });
      }
      if (rows.length < PAGE) return out;
    }
  }

  private async openPositionSymbols(): Promise<string[]> {
    return (await this.positionRisk()).map((r) => r.symbol);
  }

  /** Positions with a non-zero size (the endpoint also lists empty ones in hedge mode). */
  private async positionRisk(): Promise<BinancePositionRisk[]> {
    const rows = await this.client.signedGet<BinancePositionRisk[]>(
      "futures",
      "/fapi/v3/positionRisk",
    );
    return rows.filter((r) => !(num(r.positionAmt)?.isZero() ?? true));
  }

  private async fetchTrades(native: string, start: number, end: number): Promise<NormalizedFill[]> {
    const seen = new Set<number>();
    const out: NormalizedFill[] = [];
    let from = start;
    for (;;) {
      const rows = await this.client.signedGet<BinanceTrade[]>("futures", "/fapi/v1/userTrades", {
        symbol: native,
        startTime: from,
        endTime: end,
        limit: PAGE,
      });
      for (const t of rows) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        out.push(normalizeTrade(t));
      }
      // A full page: continue from the last timestamp (same-millisecond trades are de-duplicated).
      const last = rows.at(-1);
      if (rows.length < PAGE || !last || last.time <= from) return out;
      from = last.time;
    }
  }
}

function normalizeTrade(t: BinanceTrade): NormalizedFill {
  const { symbol, quote } = canonicalSymbol("BINANCE", t.symbol);
  // Fees paid in another asset (e.g. BNB) are converted to the quote currency afterwards.
  const feeInQuote = t.commissionAsset === quote || dec(t.commission).isZero();
  return {
    exchangeFillId: String(t.id),
    orderId: String(t.orderId),
    symbol,
    side: t.side,
    positionSide: t.positionSide,
    price: t.price,
    qty: t.qty,
    fee: feeInQuote ? t.commission : PENDING_CONVERSION,
    feeAsset: t.commissionAsset,
    realizedPnl: t.realizedPnl,
    isMaker: t.maker,
    executedAt: new Date(t.time),
    raw: t,
  };
}

function toSnapshot(r: BinancePositionRisk): OpenPositionSnapshot {
  const amount = dec(r.positionAmt);
  const direction =
    r.positionSide === "LONG" || r.positionSide === "SHORT"
      ? r.positionSide
      : amount.isNegative()
        ? "SHORT"
        : "LONG";
  // Leverage = position value / margin posted for it.
  const notional = num(r.notional)?.abs();
  const margin = num(r.positionInitialMargin ?? r.initialMargin);
  const leverage = notional && margin?.gt(0) ? str(notional.div(margin).toDecimalPlaces(2)) : null;
  return {
    externalId: `${r.symbol}:${r.positionSide}`,
    symbol: canonicalSymbol("BINANCE", r.symbol).symbol,
    direction,
    quantity: str(amount.abs()),
    entryPrice: positive(r.entryPrice),
    markPrice: positive(r.markPrice),
    unrealizedPnl: signed(r.unRealizedProfit),
    leverage,
    liquidationPrice: positive(r.liquidationPrice),
    marginMode: num(r.isolatedWallet)?.gt(0) ? "ISOLATED" : "CROSS",
    openedAt: null,
  };
}
