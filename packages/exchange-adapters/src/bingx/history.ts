import { type Dec, dec, type ExchangePositionRecord, str } from "@atc/trade-engine";
import { num as parseNum, positive, signed } from "../history/snapshot.js";
import {
  DAY_MS,
  type HistoryBatch,
  type HistorySource,
  type HistoryWindow,
  type NormalizedIncome,
  type OpenPositionSnapshot,
  type RawExchangePosition,
} from "../history/types.js";
import { canonicalSymbol } from "../symbols.js";
import type { ApiCredentials, VerificationFailure } from "../types.js";
import { mapBingxFailure } from "./adapter.js";
import { BingxClient, type BingxClientOptions } from "./client.js";

const RETENTION_MS = 88 * DAY_MS;
const MAX_WINDOW_MS = 7 * DAY_MS;
const INCOME_LIMIT = 1000;
const POSITION_PAGE = 100;
const MIN_SPLIT_MS = 60_000;
/**
 * The position-history filter may apply to opening time, so positions opened before a sync
 * window and closed inside it are found by looking back further than the window itself.
 */
const POSITION_LOOKBACK_MS = 30 * DAY_MS;

interface BingxIncome {
  symbol?: string;
  incomeType: string;
  income: string;
  asset: string;
  time: number;
  tranId?: string;
  tradeId?: string;
}

export interface BingxPosition {
  positionId: string;
  symbol: string;
  positionSide: string;
  openTime: number;
  updateTime: number;
  avgPrice?: string;
  avgClosePrice?: string;
  realisedProfit?: string; // gross
  netProfit?: string;
  positionAmt?: string;
  closePositionAmt?: string;
  leverage?: number | string;
  closeAllPositions?: boolean;
  positionCommission?: string; // negative = paid
  totalFunding?: string; // negative = paid
}

/** GET /openApi/swap/v2/user/positions */
interface BingxOpenPosition {
  positionId?: string;
  symbol: string;
  positionSide?: string;
  isolated?: boolean;
  positionAmt?: string;
  avgPrice?: string;
  markPrice?: string | number;
  unrealizedProfit?: string;
  leverage?: number | string;
  liquidationPrice?: number | string;
  createTime?: number;
}

const INCOME_TYPES: Record<string, NormalizedIncome["type"]> = {
  FUNDING_FEE: "FUNDING",
  TRADING_FEE: "COMMISSION",
  REALIZED_PNL: "REALIZED_PNL",
};

/**
 * BingX perpetuals: BingX's fill feed is inconsistent (it may omit the side), but its position
 * history is complete (entry, exit, size, commission, funding, net), so we take positions as
 * reported. Position history needs a symbol: traded symbols come from the income ledger.
 */
export class BingxHistorySource implements HistorySource {
  readonly model = "POSITIONS" as const;
  readonly maxWindowMs = MAX_WINDOW_MS;
  readonly retentionMs = RETENTION_MS;
  private readonly client: BingxClient;
  private readonly now: () => number;

  constructor(credentials: ApiCredentials, options: BingxClientOptions = {}) {
    this.client = new BingxClient(credentials, options);
    this.now = options.now ?? Date.now;
  }

  async fetchHistory({ since, until }: HistoryWindow): Promise<HistoryBatch> {
    const incomeRows = await this.fetchIncome(since.getTime(), until.getTime());
    const traded = new Set(incomeRows.map((r) => r.symbol).filter((s): s is string => Boolean(s)));

    const earliest = this.now() - RETENTION_MS;
    const from = Math.max(since.getTime() - POSITION_LOOKBACK_MS, earliest);
    const positions: RawExchangePosition[] = [];
    for (const native of [...traded].sort()) {
      for (const p of await this.fetchPositions(native, from, until.getTime())) {
        const closed = p.closeAllPositions === true;
        positions.push({
          externalId: String(p.positionId),
          symbol: canonicalSymbol("BINGX", p.symbol).symbol,
          closed,
          closedAt: closed ? new Date(p.updateTime) : null,
          raw: { position: p },
        });
      }
    }

    return {
      fills: [],
      income: incomeRows.map(
        (r): NormalizedIncome => ({
          externalId: `${r.incomeType}:${r.tranId ?? ""}:${r.tradeId ?? ""}:${r.time}`,
          type: INCOME_TYPES[r.incomeType] ?? "OTHER",
          amount: r.income,
          asset: r.asset,
          symbol: r.symbol ? canonicalSymbol("BINGX", r.symbol).symbol : null,
          occurredAt: new Date(r.time),
          raw: r,
        }),
      ),
      positions,
    };
  }

  toRecords(raws: readonly RawExchangePosition[]): ExchangePositionRecord[] {
    return raws.map((r) => toRecord(r));
  }

  async fetchOpenPositions(): Promise<OpenPositionSnapshot[]> {
    const rows =
      (await this.client.get<BingxOpenPosition[]>("/openApi/swap/v2/user/positions")) ?? [];
    return rows.flatMap((p): OpenPositionSnapshot[] => {
      const amount = parseNum(p.positionAmt);
      if (!amount || amount.isZero()) return [];
      const direction =
        p.positionSide?.toUpperCase() === "SHORT" || amount.isNegative() ? "SHORT" : "LONG";
      const size = amount.abs();
      const entry = parseNum(p.avgPrice);
      const pnl = parseNum(p.unrealizedProfit);
      // Mark price is not always in the payload; it follows from entry and unrealised PnL.
      const derivedMark =
        entry && pnl && size.gt(0)
          ? entry.plus(direction === "LONG" ? pnl.div(size) : pnl.div(size).neg())
          : null;
      return [
        {
          externalId: p.positionId ?? `${p.symbol}:${direction}`,
          symbol: canonicalSymbol("BINGX", p.symbol).symbol,
          direction,
          quantity: str(size),
          entryPrice: positive(p.avgPrice),
          markPrice:
            positive(p.markPrice) ??
            (derivedMark?.gt(0) ? str(derivedMark.toDecimalPlaces(12)) : null),
          unrealizedPnl: signed(p.unrealizedProfit),
          leverage: positive(p.leverage),
          liquidationPrice: positive(p.liquidationPrice),
          marginMode: p.isolated === undefined ? null : p.isolated ? "ISOLATED" : "CROSS",
          openedAt: p.createTime ? new Date(p.createTime) : null,
        },
      ];
    });
  }

  classify(err: unknown): VerificationFailure {
    return mapBingxFailure(err, "permissions");
  }

  /** The income endpoint has no paging: a full response means the window is split and retried. */
  private async fetchIncome(from: number, to: number): Promise<BingxIncome[]> {
    const rows =
      (await this.client.get<BingxIncome[]>("/openApi/swap/v2/user/income", {
        startTime: from,
        endTime: to,
        limit: INCOME_LIMIT,
      })) ?? [];
    if (rows.length >= INCOME_LIMIT && to - from > MIN_SPLIT_MS) {
      const mid = Math.floor((from + to) / 2);
      return [...(await this.fetchIncome(from, mid)), ...(await this.fetchIncome(mid + 1, to))];
    }
    return rows;
  }

  private async fetchPositions(native: string, from: number, to: number): Promise<BingxPosition[]> {
    const quote = canonicalSymbol("BINGX", native).quote;
    const out: BingxPosition[] = [];
    for (let pageIndex = 1; ; pageIndex++) {
      const data = await this.client.get<{
        positionHistory?: BingxPosition[];
        list?: BingxPosition[];
      }>("/openApi/swap/v1/trade/positionHistory", {
        symbol: native,
        ...(quote === "USDC" ? { currency: "USDC" } : {}),
        startTs: from,
        endTs: to,
        pageIndex,
        pageSize: POSITION_PAGE,
      });
      // Documented as `list`; observed as `positionHistory`. Accept both.
      const rows = data?.positionHistory ?? data?.list ?? [];
      out.push(...rows);
      if (rows.length < POSITION_PAGE) return out;
    }
  }
}

const num = (v: unknown): Dec | null =>
  v === undefined || v === null || v === "" ? null : dec(String(v));

/**
 * Hedge mode says LONG or SHORT. One-way mode says BOTH: then a negative size means short, and
 * otherwise the result tells: a long profits when the exit is above the entry, a short below.
 */
export function bingxDirection(p: BingxPosition): "LONG" | "SHORT" {
  const side = p.positionSide?.toUpperCase();
  if (side === "LONG" || side === "SHORT") return side;
  const amount = num(p.positionAmt);
  if (amount?.isNegative()) return "SHORT";
  const entry = num(p.avgPrice);
  const exit = num(p.avgClosePrice);
  const pnl = num(p.realisedProfit);
  if (entry && exit && pnl && !exit.eq(entry) && !pnl.isZero()) {
    return exit.gt(entry) === pnl.gt(0) ? "LONG" : "SHORT";
  }
  return "LONG";
}

function toRecord(raw: RawExchangePosition): ExchangePositionRecord {
  const p = raw.raw.position as BingxPosition;
  const commission = num(p.positionCommission);
  const exit = num(p.avgClosePrice);
  const qty = num(p.closePositionAmt) ?? num(p.positionAmt);
  return {
    externalId: raw.externalId,
    symbol: raw.symbol,
    direction: bingxDirection(p),
    closed: raw.closed,
    openedAt: new Date(p.openTime),
    closedAt: raw.closedAt,
    entryPrice: num(p.avgPrice) ? str(dec(String(p.avgPrice))) : null,
    exitPrice: exit && !exit.isZero() ? str(exit) : null,
    quantity: qty ? str(qty.abs()) : null,
    leverage: num(p.leverage)?.gt(0) ? str(dec(String(p.leverage))) : null,
    grossPnl: num(p.realisedProfit) ? str(dec(String(p.realisedProfit))) : null,
    // BingX books commission as a negative amount; the journal stores fees as positive = paid.
    fees: commission ? str(commission.neg()) : null,
    funding: num(p.totalFunding) ? str(dec(String(p.totalFunding))) : null,
    netPnl: num(p.netProfit) ? str(dec(String(p.netProfit))) : null,
  };
}
