import { D, dec, type ExchangePositionRecord, str } from "@atc/trade-engine";
import { positive, unrealizedFromPrices } from "../history/snapshot.js";
import {
  DAY_MS,
  type HistoryBatch,
  type HistorySource,
  type HistoryWindow,
  type OpenPositionSnapshot,
  type RawExchangePosition,
} from "../history/types.js";
import { stringField } from "../http.js";
import { canonicalSymbol } from "../symbols.js";
import type { ApiCredentials, VerificationFailure } from "../types.js";
import { mapMexcFailure } from "./adapter.js";
import { MexcClient, type MexcClientOptions } from "./client.js";

const PAGE_SIZE = 100;
const RETENTION_MS = 88 * DAY_MS;
/** Safety stop: 300 pages x 100 positions (far beyond 3 months of real trading). */
const MAX_PAGES = 300;
/**
 * MEXC does not document the page order. We stop only after this many consecutive pages without a
 * single position in the window, so a long-held position closed recently is not missed even if
 * pages are ordered by opening time.
 */
const EMPTY_PAGES_TO_STOP = 2;
const CLOSED_STATE = "3";

interface MexcPosition {
  positionId: string | number;
  symbol: string;
  positionType: string | number; // 1 long, 2 short
  openType?: string | number; // 1 isolated, 2 cross
  state: string | number; // 1 holding, 3 closed
  holdAvgPrice?: string | number;
  liquidatePrice?: string | number;
  closeVol?: string | number;
  holdVol?: string | number;
  openAvgPrice?: string | number;
  closeAvgPrice?: string | number;
  realised?: string | number;
  closeProfitLoss?: string | number;
  fee?: string | number;
  leverage?: string | number;
  createTime: string | number;
  updateTime: string | number;
}

/**
 * MEXC USDT-M: MEXC computes closed positions itself (entry, exit, fees, realised PnL), so we take
 * them as reported. Sizes are in contracts and are converted with each contract's size.
 * The history endpoint has no time filter, so we page until pages stop containing the window.
 */
export class MexcHistorySource implements HistorySource {
  readonly model = "POSITIONS" as const;
  readonly maxWindowMs = RETENTION_MS;
  readonly retentionMs = RETENTION_MS;
  private readonly client: MexcClient;
  private contractSizes: Promise<Map<string, string>> | undefined;

  constructor(credentials: ApiCredentials, options: MexcClientOptions = {}) {
    this.client = new MexcClient(credentials, options);
  }

  async fetchHistory({ since, until }: HistoryWindow): Promise<HistoryBatch> {
    const sizes = await this.loadContractSizes();
    const positions: RawExchangePosition[] = [];
    let emptyPages = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const rows =
        (await this.client.futuresGet<MexcPosition[]>(
          "/api/v1/private/position/list/history_positions",
          {
            page_num: page,
            page_size: PAGE_SIZE,
          },
        )) ?? [];
      let inWindow = 0;
      for (const row of rows) {
        const updated = Number(row.updateTime);
        if (updated < since.getTime() || updated > until.getTime()) continue;
        inWindow++;
        const closed = String(row.state) === CLOSED_STATE;
        positions.push({
          externalId: String(row.positionId),
          symbol: canonicalSymbol("MEXC", row.symbol).symbol,
          closed,
          closedAt: closed ? new Date(updated) : null,
          raw: { position: row, contractSize: sizes.get(row.symbol) ?? null },
        });
      }
      emptyPages = inWindow === 0 ? emptyPages + 1 : 0;
      if (rows.length < PAGE_SIZE || emptyPages >= EMPTY_PAGES_TO_STOP) break;
    }
    return { fills: [], income: [], positions };
  }

  toRecords(raws: readonly RawExchangePosition[]): ExchangePositionRecord[] {
    return raws.map((r) => toRecord(r));
  }

  /**
   * MEXC reports open positions without a mark price or unrealised PnL, so both come from the
   * public fair (mark) price, the price MEXC itself uses for unrealised PnL.
   */
  async fetchOpenPositions(): Promise<OpenPositionSnapshot[]> {
    const rows =
      (await this.client.futuresGet<MexcPosition[]>("/api/v1/private/position/open_positions")) ??
      [];
    const open = rows.filter((r) => num(r.holdVol)?.gt(0) ?? false);
    if (open.length === 0) return [];
    const [sizes, tickers] = await Promise.all([
      this.loadContractSizes(),
      this.client.futuresPublicGet<{ symbol: string; fairPrice?: number | string }[]>(
        "/api/v1/contract/ticker",
      ),
    ]);
    const fair = new Map((tickers ?? []).map((t) => [t.symbol, num(t.fairPrice)]));
    return open.map((r) => {
      const { symbol, inverse } = canonicalSymbol("MEXC", r.symbol);
      const direction = String(r.positionType) === "2" ? "SHORT" : "LONG";
      const contractSize = num(sizes.get(r.symbol));
      const size = contractSize ? (num(r.holdVol) ?? dec(0)).times(contractSize) : null;
      const hold = num(r.holdAvgPrice) ?? num(r.openAvgPrice);
      const mark = fair.get(r.symbol) ?? null;
      return {
        externalId: String(r.positionId),
        symbol,
        direction,
        // Without a contract size the coin amount is unknown: show the position, not a wrong size.
        quantity: size ? str(size) : null,
        entryPrice: positive(r.openAvgPrice) ?? positive(r.holdAvgPrice),
        markPrice: mark?.gt(0) ? str(mark) : null,
        unrealizedPnl:
          size && hold && mark
            ? unrealizedFromPrices({ direction, size, entry: hold, mark, inverse })
            : null,
        leverage: positive(r.leverage),
        liquidationPrice: positive(r.liquidatePrice),
        marginMode:
          String(r.openType) === "1" ? "ISOLATED" : String(r.openType) === "2" ? "CROSS" : null,
        openedAt: Number(r.createTime) > 0 ? new Date(Number(r.createTime)) : null,
      };
    });
  }

  classify(err: unknown): VerificationFailure {
    return mapMexcFailure(err, "keyInfo");
  }

  private loadContractSizes(): Promise<Map<string, string>> {
    this.contractSizes ??= this.client
      .futuresPublicGet<{ symbol: string; contractSize: number | string }[]>(
        "/api/v1/contract/detail",
      )
      .then((rows) => new Map((rows ?? []).map((r) => [r.symbol, String(r.contractSize)])))
      .catch((err: unknown) => {
        this.contractSizes = undefined;
        throw err;
      });
    return this.contractSizes;
  }
}

const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : dec(String(v)));

function toRecord(raw: RawExchangePosition): ExchangePositionRecord {
  const p = raw.raw.position as MexcPosition;
  const contractSize = stringField(raw.raw, "contractSize");
  const vol = num(p.closeVol)?.plus(num(p.holdVol) ?? 0) ?? null;
  const gross = num(p.closeProfitLoss);
  const fees = num(p.fee);
  const net = num(p.realised);
  // MEXC reports gross, fee and realised; funding is what reconciles them.
  const funding = gross && fees && net ? net.minus(gross).plus(fees) : null;
  const exit = num(p.closeAvgPrice);

  return {
    externalId: raw.externalId,
    symbol: raw.symbol,
    direction: String(p.positionType) === "2" ? "SHORT" : "LONG",
    closed: raw.closed,
    openedAt: new Date(Number(p.createTime)),
    closedAt: raw.closedAt,
    entryPrice: num(p.openAvgPrice) ? str(dec(String(p.openAvgPrice))) : null,
    exitPrice: exit && !exit.isZero() ? str(exit) : null,
    quantity: vol && contractSize ? str(vol.times(contractSize)) : null,
    leverage: num(p.leverage) ? str(D.max(dec(String(p.leverage)), 0)) : null,
    grossPnl: gross ? str(gross) : null,
    fees: fees ? str(fees) : null,
    funding: funding ? str(funding) : null,
    netPnl: net ? str(net) : null,
  };
}
