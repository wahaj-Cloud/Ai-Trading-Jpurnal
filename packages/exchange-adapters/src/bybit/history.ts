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
import { type ApiCredentials, ExchangeHttpError, type VerificationFailure } from "../types.js";
import { mapBybitFailure } from "./adapter.js";
import { BybitClient, type BybitClientOptions } from "./client.js";

/** /v5/execution/list accepts at most 7 days per request. */
const MAX_WINDOW_MS = 7 * DAY_MS - 1_000;
/** Bybit keeps two years of executions; stay a little inside that. */
const RETENTION_MS = 720 * DAY_MS;
const PAGE = 100;
/** USDT perpetuals, and USDC perpetuals (BTCPERP, ETHUSDC…). */
const SETTLE_COINS = ["USDT", "USDC"] as const;
/** Executions that change a position. Funding arrives as its own execution type. */
const TRADE_TYPES = new Set(["Trade", "AdlTrade", "BustTrade", "BlockTrade", "MovePosition"]);

export interface BybitExecution {
  symbol: string;
  execId: string;
  orderId?: string;
  side: "Buy" | "Sell";
  execPrice: string;
  execQty: string;
  execFee?: string;
  feeCurrency?: string;
  execType: string;
  execTime: string;
  isMaker?: boolean;
  closedSize?: string;
}

interface BybitPage<T> {
  list?: T[];
  nextPageCursor?: string;
}

/** GET /v5/position/list row. */
interface BybitOpenPosition {
  symbol: string;
  positionIdx?: number;
  side?: "Buy" | "Sell" | "";
  size?: string;
  avgPrice?: string;
  markPrice?: string;
  unrealisedPnl?: string;
  leverage?: string;
  liqPrice?: string;
  tradeMode?: number;
  createdTime?: string;
}

/** Only perpetuals: dated futures (BTC-27DEC24, BTCUSDT-27DEC24) never merge with them. */
const isPerpetual = (symbol: string) => !symbol.includes("-");

/**
 * Splits a Bybit execution into the journal's fills. `closedSize` says how much of the fill closed
 * an existing position, which tells opening from closing fills in both one-way and hedge mode:
 *  - nothing closed: the fill opens (Buy opens a long, Sell a short);
 *  - all closed: the fill closes (Sell closes a long, Buy a short);
 *  - part closed (one-way mode flip): a closing fill plus an opening fill, fee shared pro rata.
 */
export function bybitFills(e: BybitExecution, settle: string): NormalizedFill[] {
  const qty = num(e.execQty);
  if (!qty || qty.lte(0)) return [];
  const closed = num(e.closedSize)?.abs() ?? dec(0);
  const fee = num(e.execFee) ?? dec(0);
  const buy = e.side === "Buy";
  const base = {
    orderId: e.orderId || null,
    symbol: canonicalSymbol("BYBIT", e.symbol).symbol,
    side: buy ? ("BUY" as const) : ("SELL" as const),
    price: str(dec(e.execPrice)),
    feeAsset: e.feeCurrency || settle,
    realizedPnl: null,
    isMaker: typeof e.isMaker === "boolean" ? e.isMaker : null,
    executedAt: new Date(Number(e.execTime)),
    raw: e,
  };
  const opening = { ...base, positionSide: buy ? ("LONG" as const) : ("SHORT" as const) };
  const closing = { ...base, positionSide: buy ? ("SHORT" as const) : ("LONG" as const) };
  if (closed.isZero()) {
    return [{ ...opening, exchangeFillId: e.execId, qty: str(qty), fee: str(fee) }];
  }
  if (closed.gte(qty)) {
    return [{ ...closing, exchangeFillId: e.execId, qty: str(qty), fee: str(fee) }];
  }
  const closeFee = fee.times(closed).div(qty);
  return [
    { ...closing, exchangeFillId: `${e.execId}:close`, qty: str(closed), fee: str(closeFee) },
    {
      ...opening,
      exchangeFillId: `${e.execId}:open`,
      qty: str(qty.minus(closed)),
      fee: str(fee.minus(closeFee)),
    },
  ];
}

/**
 * Bybit linear perpetuals (USDT and USDC). Executions carry `closedSize`, so our engine rebuilds
 * full round trips (with opening time, average entry and every partial close) the same way as for
 * Binance; funding payments arrive in the same feed as executions of type "Funding".
 */
export class BybitHistorySource implements HistorySource {
  readonly model = "FILLS" as const;
  readonly maxWindowMs = MAX_WINDOW_MS;
  readonly retentionMs = RETENTION_MS;
  private readonly client: BybitClient;

  constructor(credentials: ApiCredentials, options: BybitClientOptions = {}) {
    this.client = new BybitClient(credentials, options);
  }

  async fetchHistory({ since, until }: HistoryWindow): Promise<HistoryBatch> {
    const fills: NormalizedFill[] = [];
    const income: NormalizedIncome[] = [];
    for (const settle of SETTLE_COINS) {
      const rows = await this.executions(settle, since.getTime(), until.getTime());
      for (const e of rows) {
        if (!isPerpetual(e.symbol)) continue;
        if (e.execType === "Funding") {
          const fee = num(e.execFee);
          if (!fee || fee.isZero()) continue;
          income.push({
            externalId: `funding:${e.execId}`,
            type: "FUNDING",
            // Bybit reports funding as a fee: positive = paid, so the ledger amount is negated.
            amount: str(fee.neg()),
            asset: e.feeCurrency || settle,
            symbol: canonicalSymbol("BYBIT", e.symbol).symbol,
            occurredAt: new Date(Number(e.execTime)),
            raw: e,
          });
        } else if (TRADE_TYPES.has(e.execType)) {
          fills.push(...bybitFills(e, settle));
        }
      }
    }
    return { fills, income, positions: [] };
  }

  toRecords(): ExchangePositionRecord[] {
    return []; // positions come from fills
  }

  async fetchOpenPositions(): Promise<OpenPositionSnapshot[]> {
    const out: OpenPositionSnapshot[] = [];
    for (const settle of SETTLE_COINS) {
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const data = await this.optionalSettle(settle, () =>
          this.client.get<BybitPage<BybitOpenPosition>>("/v5/position/list", {
            category: "linear",
            settleCoin: settle,
            limit: 200,
            ...(cursor ? { cursor } : {}),
          }),
        );
        for (const p of data?.list ?? []) {
          const size = num(p.size);
          if (!size || size.isZero() || !isPerpetual(p.symbol) || !p.side) continue;
          out.push({
            externalId: `${p.symbol}:${p.positionIdx ?? 0}`,
            symbol: canonicalSymbol("BYBIT", p.symbol).symbol,
            direction: p.side === "Sell" ? "SHORT" : "LONG",
            quantity: str(size.abs()),
            entryPrice: positive(p.avgPrice),
            markPrice: positive(p.markPrice),
            unrealizedPnl: signed(p.unrealisedPnl),
            leverage: positive(p.leverage),
            liquidationPrice: positive(p.liqPrice),
            marginMode: p.tradeMode === 1 ? "ISOLATED" : p.tradeMode === 0 ? "CROSS" : null,
            openedAt: Number(p.createdTime) > 0 ? new Date(Number(p.createdTime)) : null,
          });
        }
        cursor = data?.nextPageCursor || undefined;
        if (!cursor || (data?.list ?? []).length === 0) break;
      }
    }
    return out;
  }

  classify(err: unknown): VerificationFailure {
    return mapBybitFailure(err, "keyInfo");
  }

  private async executions(settle: string, from: number, to: number): Promise<BybitExecution[]> {
    const out: BybitExecution[] = [];
    let cursor: string | undefined;
    for (;;) {
      const data = await this.optionalSettle(settle, () =>
        this.client.get<BybitPage<BybitExecution>>("/v5/execution/list", {
          category: "linear",
          settleCoin: settle,
          startTime: from,
          endTime: to,
          limit: PAGE,
          ...(cursor ? { cursor } : {}),
        }),
      );
      const rows = data?.list ?? [];
      out.push(...rows);
      cursor = data?.nextPageCursor || undefined;
      if (!cursor || rows.length === 0) return out;
    }
  }

  /**
   * Accounts without USDC contracts (classic accounts) reject settleCoin=USDC as a bad parameter;
   * that just means there is nothing to fetch. Every other error is real.
   */
  private async optionalSettle<T>(settle: string, call: () => Promise<T>): Promise<T | null> {
    try {
      return await call();
    } catch (err) {
      if (settle !== "USDT" && err instanceof ExchangeHttpError && err.exchangeCode === 10001) {
        return null;
      }
      throw err;
    }
  }
}
