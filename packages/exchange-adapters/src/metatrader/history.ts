import { dec, type ExchangePositionRecord, str, ZERO } from "@atc/trade-engine";
import {
  DAY_MS,
  type HistoryBatch,
  type HistorySource,
  type HistoryWindow,
  type OpenPositionSnapshot,
  type RawExchangePosition,
} from "../history/types.js";
import { canonicalSymbol } from "../symbols.js";
import {
  type ApiCredentials,
  ExchangeHttpError,
  ExchangeNetworkError,
  type VerificationFailure,
} from "../types.js";
import {
  type AccountRef,
  type MetaApiAccountInformation,
  MetaApiClient,
  type MetaApiDeal,
  MetaApiError,
  MetaApiNotConfiguredError,
  type MetaApiOptions,
} from "./metaapi.js";

/** MetaTrader keeps the account's whole history; we import the last 12 months. */
const RETENTION_MS = 365 * DAY_MS;
const MAX_WINDOW_MS = 30 * DAY_MS;
const TRADE_DEALS = new Set(["DEAL_TYPE_BUY", "DEAL_TYPE_SELL"]);
/** Cent accounts report money in US cents. */
const CENT_CURRENCIES = new Set(["USC"]);

/** One stored deal, with what is needed to read it later without the network. */
interface DealRaw extends Record<string, unknown> {
  deal: MetaApiDeal;
  /** Units per lot (e.g. 100 oz of gold), from the symbol specification; null if unknown. */
  contractSize: number | null;
  /** Account currency when downloaded (USD, USC, EUR, ...). */
  currency: string;
  leverage: number | null;
}

/**
 * MetaTrader broker accounts (Exness) through MetaApi. MetaTrader 5 reports deals (executions)
 * grouped by position ID; each deal is stored as it arrives, and positions are rebuilt from all
 * stored deals of a symbol, so a position's opening and closing deals may arrive in different syncs.
 * Volumes are lots, converted to units with the symbol's contract size; profit, commission and swap
 * are in the account currency (cent accounts are converted to USD).
 */
export class MetatraderHistorySource implements HistorySource {
  readonly model = "POSITIONS" as const;
  readonly maxWindowMs = MAX_WINDOW_MS;
  readonly retentionMs = RETENTION_MS;
  private readonly client: MetaApiClient;
  private readonly accountId: string;
  private ref: Promise<AccountRef> | undefined;
  private info: Promise<MetaApiAccountInformation> | undefined;
  private readonly specs = new Map<string, Promise<number | null>>();

  constructor(credentials: ApiCredentials, options: MetaApiOptions = {}) {
    // For MetaTrader connections the stored credential holds the MetaApi account id, not a password.
    this.accountId = credentials.apiSecret;
    this.client = new MetaApiClient(options);
  }

  async fetchHistory({ since, until }: HistoryWindow): Promise<HistoryBatch> {
    const ref = await this.account();
    const info = await this.accountInfo();
    const deals = (await this.client.deals(ref, since, until)).filter(
      (d) => TRADE_DEALS.has(d.type) && d.symbol && d.positionId,
    );
    const positions: RawExchangePosition[] = [];
    for (const deal of deals) {
      const raw: DealRaw = {
        deal,
        contractSize: await this.contractSize(deal.symbol as string),
        currency: info.currency,
        leverage: typeof info.leverage === "number" ? info.leverage : null,
      };
      positions.push({
        externalId: `D:${deal.id}`,
        symbol: canonicalSymbol("EXNESS", deal.symbol as string).symbol,
        closed: true,
        closedAt: new Date(deal.time),
        raw,
      });
    }
    return { fills: [], income: [], positions };
  }

  toRecords(raws: readonly RawExchangePosition[]): ExchangePositionRecord[] {
    const byPosition = new Map<string, DealRaw[]>();
    for (const r of raws) {
      const raw = r.raw as DealRaw;
      const key = String(raw.deal?.positionId ?? "");
      if (!key) continue;
      byPosition.set(key, [...(byPosition.get(key) ?? []), raw]);
    }
    return [...byPosition.entries()].map(([positionId, list]) => toRecord(positionId, list));
  }

  async fetchOpenPositions(): Promise<OpenPositionSnapshot[]> {
    const ref = await this.account();
    const info = await this.accountInfo();
    const rows = await this.client.positions(ref);
    const out: OpenPositionSnapshot[] = [];
    for (const p of rows) {
      const size = await this.contractSize(p.symbol);
      const money = moneyIn(info.currency);
      out.push({
        externalId: String(p.id),
        symbol: canonicalSymbol("EXNESS", p.symbol).symbol,
        direction: p.type === "POSITION_TYPE_SELL" ? "SHORT" : "LONG",
        quantity: size ? str(dec(p.volume).times(size)) : null,
        lots: str(dec(p.volume)),
        entryPrice: p.openPrice > 0 ? str(dec(p.openPrice)) : null,
        markPrice: p.currentPrice && p.currentPrice > 0 ? str(dec(p.currentPrice)) : null,
        unrealizedPnl:
          typeof p.unrealizedProfit === "number" ? str(money(dec(p.unrealizedProfit))) : null,
        leverage: typeof info.leverage === "number" ? String(info.leverage) : null,
        liquidationPrice: null,
        marginMode: null,
        openedAt: new Date(p.time),
      });
    }
    return out;
  }

  classify(err: unknown): VerificationFailure {
    return classifyMetaApi(err);
  }

  /** Region of the cloud account; also checks it is running (and starts it if it was stopped). */
  private account(): Promise<AccountRef> {
    this.ref ??= this.client.getAccount(this.accountId).then(async (a) => {
      if (a.state === "UNDEPLOYED" || a.state === "CREATED") await this.client.deploy(a._id);
      if (a.state !== "DEPLOYED" || a.connectionStatus !== "CONNECTED") {
        throw new MetaApiError(503, "NOT_CONNECTED", "MetaTrader terminal is not connected yet");
      }
      return { id: a._id, region: a.region };
    });
    return this.ref;
  }

  private async accountInfo(): Promise<MetaApiAccountInformation> {
    const ref = await this.account();
    this.info ??= this.client.accountInformation(ref);
    return this.info;
  }

  private contractSize(symbol: string): Promise<number | null> {
    let p = this.specs.get(symbol);
    if (!p) {
      p = this.account()
        .then((ref) => this.client.symbolSpecification(ref, symbol))
        .then((s) => (s?.contractSize && s.contractSize > 0 ? s.contractSize : null));
      this.specs.set(symbol, p);
    }
    return p;
  }
}

/** Account-currency amounts to the currency we report: cents become dollars. */
function moneyIn(currency: string): (v: ReturnType<typeof dec>) => ReturnType<typeof dec> {
  return CENT_CURRENCIES.has(currency.toUpperCase()) ? (v) => v.div(100) : (v) => v;
}

function settleOf(currency: string): string {
  const c = currency.toUpperCase();
  return CENT_CURRENCIES.has(c) ? "USD" : c;
}

const sum = (list: DealRaw[], f: (d: MetaApiDeal) => number | undefined) =>
  list.reduce((s, r) => s.plus(dec(f(r.deal) ?? 0)), ZERO);

function vwap(list: DealRaw[]): string | null {
  const vol = sum(list, (d) => d.volume);
  if (vol.isZero()) return null;
  return str(
    list.reduce((s, r) => s.plus(dec(r.deal.price ?? 0).times(r.deal.volume ?? 0)), ZERO).div(vol),
  );
}

/** One MetaTrader position from all of its deals. */
export function toRecord(positionId: string, list: DealRaw[]): ExchangePositionRecord {
  const deals = [...list].sort(
    (a, b) =>
      Date.parse(a.deal.time) - Date.parse(b.deal.time) || a.deal.id.localeCompare(b.deal.id),
  );
  const first = deals[0] as DealRaw;
  const ins = deals.filter((r) => r.deal.entryType === "DEAL_ENTRY_IN");
  const outs = deals.filter((r) => r.deal.entryType !== "DEAL_ENTRY_IN");
  const opening = ins[0] ?? first;
  // The opening deal's side is the position's; without it, a closing SELL closed a long.
  const direction =
    ins.length > 0
      ? opening.deal.type === "DEAL_TYPE_SELL"
        ? "SHORT"
        : "LONG"
      : opening.deal.type === "DEAL_TYPE_SELL"
        ? "LONG"
        : "SHORT";
  const inVol = sum(ins, (d) => d.volume);
  const outVol = sum(outs, (d) => d.volume);
  const closed = outs.length > 0 && outVol.gte(inVol.minus(1e-9));
  const currency = first.currency ?? "USD";
  const money = moneyIn(currency);
  const contractSize = first.contractSize;
  const lots = ins.length > 0 ? inVol : outVol;
  const gross = money(sum(deals, (d) => d.profit));
  const commission = money(sum(deals, (d) => d.commission)); // negative = paid
  const swap = money(sum(deals, (d) => d.swap)); // negative = paid
  return {
    externalId: `P:${positionId}`,
    symbol: canonicalSymbol("EXNESS", opening.deal.symbol as string).symbol,
    direction,
    closed,
    openedAt: new Date(opening.deal.time),
    closedAt: closed ? new Date((deals.at(-1) as DealRaw).deal.time) : null,
    entryPrice: vwap(ins),
    exitPrice: vwap(outs),
    quantity: contractSize ? str(lots.times(contractSize)) : null,
    lots: str(lots),
    leverage: first.leverage ? String(first.leverage) : null,
    grossPnl: str(gross),
    fees: str(commission.neg()),
    funding: str(swap),
    netPnl: str(gross.plus(commission).plus(swap)),
    settleAsset: settleOf(currency),
    incompleteHistory: ins.length === 0,
  };
}

/** Sync failures, in the same codes and plain messages as key verification. */
export function classifyMetaApi(err: unknown): VerificationFailure {
  if (err instanceof MetaApiNotConfiguredError) {
    return {
      ok: false,
      code: "EXCHANGE_UNAVAILABLE",
      message: "Exness syncing is not switched on yet. It will start automatically once it is.",
    };
  }
  if (err instanceof ExchangeNetworkError) {
    return {
      ok: false,
      code: "EXCHANGE_UNAVAILABLE",
      message: "MetaTrader could not be reached. We will retry.",
    };
  }
  if (err instanceof MetaApiError) {
    if (err.status === 429)
      return { ok: false, code: "RATE_LIMITED", message: "MetaTrader is busy. We will retry." };
    if (err.code === "NOT_CONNECTED")
      return {
        ok: false,
        code: "EXCHANGE_UNAVAILABLE",
        message: "Your MetaTrader account is reconnecting. We will retry in a few minutes.",
      };
    if (err.status === 404)
      return {
        ok: false,
        code: "KEY_EXPIRED",
        message: "This MetaTrader connection no longer exists. Connect the account again.",
      };
  }
  if (err instanceof ExchangeHttpError && err.status >= 500)
    return {
      ok: false,
      code: "EXCHANGE_UNAVAILABLE",
      message: "MetaTrader is temporarily unavailable. We will retry.",
    };
  return {
    ok: false,
    code: "EXCHANGE_UNAVAILABLE",
    message: "MetaTrader sync failed. We will retry.",
  };
}
