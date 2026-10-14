import { type Dec, dec, type ExchangePositionRecord, str } from "@atc/trade-engine";
import { num, positive, signed } from "../history/snapshot.js";
import {
  DAY_MS,
  type HistoryBatch,
  type HistorySource,
  type HistoryWindow,
  type NormalizedIncome,
  type OpenPositionSnapshot,
  type RawExchangePosition,
} from "../history/types.js";
import { stringField } from "../http.js";
import { canonicalSymbol } from "../symbols.js";
import type { ApiCredentials, VerificationFailure } from "../types.js";
import { mapOkxFailure } from "./adapter.js";
import { OkxClient, type OkxClientOptions } from "./client.js";

/** Position history and archived bills cover the last 3 months; stay a little inside that. */
const RETENTION_MS = 88 * DAY_MS;
const MAX_WINDOW_MS = 30 * DAY_MS;
const PAGE = 100;
/** Bill type 8 = funding fee. */
const FUNDING_BILL = "8";
/** Latest close type: 2 full close, 3 liquidation, 6 ADL fully closed. */
const FULLY_CLOSED = new Set(["2", "3", "6"]);

/** GET /api/v5/account/positions-history row. Sizes are in contracts. */
export interface OkxClosedPosition {
  instId: string;
  posId: string;
  type?: string;
  cTime: string;
  uTime: string;
  openAvgPx?: string;
  closeAvgPx?: string;
  openMaxPos?: string;
  closeTotalPos?: string;
  /** Closing P&L excluding fees. */
  pnl?: string;
  /** Negative = charged, positive = rebate. */
  fee?: string;
  /** Positive = received. */
  fundingFee?: string;
  /** Negative when charged. */
  liqPenalty?: string;
  /** pnl + fee + fundingFee + liqPenalty (+ settledPnl). */
  realizedPnl?: string;
  direction?: string;
  posSide?: string;
  lever?: string;
}

interface OkxOpenPosition {
  instId: string;
  posId?: string;
  /** Contracts; signed in net mode (negative = short). */
  pos?: string;
  posSide?: string;
  avgPx?: string;
  markPx?: string;
  upl?: string;
  lever?: string;
  liqPx?: string;
  mgnMode?: string;
  cTime?: string;
}

interface OkxBill {
  billId: string;
  instId?: string;
  ccy: string;
  balChg: string;
  ts: string;
  type: string;
}

interface OkxInstrument {
  instId: string;
  ctVal: string;
  ctType?: string;
}

/**
 * OKX perpetual swaps. OKX computes positions itself (entry, exit, size, fees, funding and net
 * P&L per position), so we take them as reported, converting contracts to coins with each
 * contract's size. Funding payments also come from the bill archive for the funding ledger.
 */
export class OkxHistorySource implements HistorySource {
  readonly model = "POSITIONS" as const;
  readonly maxWindowMs = MAX_WINDOW_MS;
  readonly retentionMs = RETENTION_MS;
  private readonly client: OkxClient;
  private instruments: Promise<Map<string, OkxInstrument>> | undefined;

  constructor(credentials: ApiCredentials, options: OkxClientOptions = {}) {
    this.client = new OkxClient(credentials, options);
  }

  async fetchHistory({ since, until }: HistoryWindow): Promise<HistoryBatch> {
    const [rows, bills, specs] = await Promise.all([
      this.closedPositions(since.getTime(), until.getTime()),
      this.fundingBills(since.getTime(), until.getTime()),
      this.loadInstruments(),
    ]);
    const positions: RawExchangePosition[] = rows.map((p) => {
      const closed = FULLY_CLOSED.has(String(p.type ?? ""));
      const spec = specs.get(p.instId);
      return {
        externalId: `${p.posId}:${p.cTime}`,
        symbol: canonicalSymbol("OKX", p.instId).symbol,
        closed,
        closedAt: closed ? new Date(Number(p.uTime)) : null,
        raw: { position: p, contractValue: spec?.ctVal ?? null },
      };
    });
    const income = bills.map(
      (b): NormalizedIncome => ({
        externalId: `bill:${b.billId}`,
        type: "FUNDING",
        amount: b.balChg,
        asset: b.ccy,
        symbol: b.instId ? canonicalSymbol("OKX", b.instId).symbol : null,
        occurredAt: new Date(Number(b.ts)),
        raw: b,
      }),
    );
    return { fills: [], income, positions };
  }

  toRecords(raws: readonly RawExchangePosition[]): ExchangePositionRecord[] {
    return raws.map(okxRecord);
  }

  async fetchOpenPositions(): Promise<OpenPositionSnapshot[]> {
    const [rows, specs] = await Promise.all([
      this.client.get<OkxOpenPosition[]>("/api/v5/account/positions", { instType: "SWAP" }),
      this.loadInstruments(),
    ]);
    return (rows ?? []).flatMap((p): OpenPositionSnapshot[] => {
      const contracts = num(p.pos);
      if (!contracts || contracts.isZero()) return [];
      const ctVal = num(specs.get(p.instId)?.ctVal);
      const side = p.posSide?.toLowerCase();
      const direction =
        side === "short" || (side !== "long" && contracts.isNegative()) ? "SHORT" : "LONG";
      return [
        {
          externalId: p.posId || `${p.instId}:${direction}`,
          symbol: canonicalSymbol("OKX", p.instId).symbol,
          direction,
          quantity: ctVal ? str(contracts.abs().times(ctVal)) : null,
          entryPrice: positive(p.avgPx),
          markPrice: positive(p.markPx),
          unrealizedPnl: signed(p.upl),
          leverage: positive(p.lever),
          liquidationPrice: positive(p.liqPx),
          marginMode:
            p.mgnMode === "isolated" ? "ISOLATED" : p.mgnMode === "cross" ? "CROSS" : null,
          openedAt: Number(p.cTime) > 0 ? new Date(Number(p.cTime)) : null,
        },
      ];
    });
  }

  classify(err: unknown): VerificationFailure {
    return mapOkxFailure(err, "config");
  }

  /** Newest first by update time; `after` pages back to older records. */
  private async closedPositions(from: number, to: number): Promise<OkxClosedPosition[]> {
    const out: OkxClosedPosition[] = [];
    let after = to + 1;
    for (;;) {
      const rows =
        (await this.client.get<OkxClosedPosition[]>("/api/v5/account/positions-history", {
          instType: "SWAP",
          after,
          limit: PAGE,
        })) ?? [];
      let oldest = after;
      for (const r of rows) {
        const t = Number(r.uTime);
        oldest = Math.min(oldest, t);
        if (t >= from && t <= to) out.push(r);
      }
      if (rows.length < PAGE || oldest < from || oldest >= after) return out;
      after = oldest;
    }
  }

  private async fundingBills(from: number, to: number): Promise<OkxBill[]> {
    const out: OkxBill[] = [];
    let after: string | undefined;
    for (;;) {
      const rows =
        (await this.client.get<OkxBill[]>("/api/v5/account/bills-archive", {
          instType: "SWAP",
          type: FUNDING_BILL,
          begin: from,
          end: to,
          limit: PAGE,
          ...(after ? { after } : {}),
        })) ?? [];
      out.push(...rows);
      const last = rows.at(-1)?.billId;
      if (rows.length < PAGE || !last || last === after) return out;
      after = last;
    }
  }

  private loadInstruments(): Promise<Map<string, OkxInstrument>> {
    this.instruments ??= this.client
      .publicGet<OkxInstrument[]>("/api/v5/public/instruments", { instType: "SWAP" })
      .then((rows) => new Map((rows ?? []).map((r) => [r.instId, r])))
      .catch((err: unknown) => {
        this.instruments = undefined;
        throw err;
      });
    return this.instruments;
  }
}

const opt = (v: unknown): Dec | null => num(v);

/** One OKX position as a journal record (contracts converted with the stored contract value). */
export function okxRecord(raw: RawExchangePosition): ExchangePositionRecord {
  const p = raw.raw.position as OkxClosedPosition;
  const ctVal = opt(stringField(raw.raw, "contractValue"));
  const contracts = opt(p.closeTotalPos)?.gt(0) ? opt(p.closeTotalPos) : opt(p.openMaxPos);
  const fee = opt(p.fee);
  const liq = opt(p.liqPenalty);
  const exit = opt(p.closeAvgPx);
  // The journal stores fees as positive = paid; OKX reports them negative when charged.
  const fees = fee || liq ? (fee ?? dec(0)).plus(liq ?? 0).neg() : null;
  const direction =
    (p.direction ?? p.posSide)?.toLowerCase() === "short" ? ("SHORT" as const) : ("LONG" as const);
  return {
    externalId: raw.externalId,
    symbol: raw.symbol,
    direction,
    closed: raw.closed,
    openedAt: new Date(Number(p.cTime)),
    closedAt: raw.closedAt,
    entryPrice: positive(p.openAvgPx),
    exitPrice: exit && exit.gt(0) ? str(exit) : null,
    quantity: contracts && ctVal ? str(contracts.abs().times(ctVal)) : null,
    leverage: positive(p.lever),
    grossPnl: signed(p.pnl),
    fees: fees ? str(fees) : null,
    funding: signed(p.fundingFee),
    netPnl: signed(p.realizedPnl),
  };
}
