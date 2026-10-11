import { type Dec, dec, type ExchangePositionRecord, str, sum, ZERO } from "@atc/trade-engine";
import { positive, signed } from "../history/snapshot.js";
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
import { type ApiCredentials, ExchangeHttpError, type VerificationFailure } from "../types.js";
import { mapKucoinFailure } from "./adapter.js";
import { KucoinClient, type KucoinClientOptions } from "./client.js";

const RETENTION_MS = 88 * DAY_MS;
/** KuCoin history queries accept at most 7 days (same limit as its fills endpoint). */
const MAX_WINDOW_MS = 7 * DAY_MS - 1_000;
const CLASSIC_LIMIT = 200;
const UTA_PAGE = 100;
/**
 * The unified endpoint may return fewer rows per page than asked for. Any page at least this full
 * is treated as possibly truncated and the window is split, so trades are never silently dropped.
 */
const UTA_SPLIT_AT = 50;
const MIN_SPLIT_MS = 60_000;

type AccountMode = "CLASSIC" | "UNIFIED";

/** Classic futures account: one record per close event; partial closes share a positionId. */
interface ClassicClose {
  closeId: string;
  positionId: string;
  symbol: string;
  type?: string; // CLOSE_LONG, CLOSE_PARTIAL_SHORT, LIQUID_LONG, ADL_SHORT, ...
  side?: string | null;
  closeSize?: string | number | null;
  pnl?: string | number | null; // net
  realisedGrossCost?: string | number | null; // positive = loss
  tradeFee?: string | number | null;
  fundingFee?: string | number | null;
  leverage?: string | number | null;
  openTime?: number | null;
  closeTime?: number | null;
  openPrice?: string | number | null;
  closePrice?: string | number | null;
}

/** Unified Trading Account: one record per closed position; times in nanoseconds. */
interface UnifiedClose {
  closeId: string;
  symbol: string;
  side: string; // LONG | SHORT
  entryPrice?: string | null;
  avgClosePrice?: string | null;
  closePrice?: string | null;
  maxSize?: string | null; // lots
  leverage?: string | null;
  realizedPnL?: string | null; // net
  fee?: string | null;
  fundingFee?: string | null;
  closingTime: number | string;
  creationTime: number | string;
}

/** Classic futures account: GET /api/v1/positions. Sizes are signed lots. */
interface ClassicOpen {
  id?: string;
  symbol: string;
  isOpen?: boolean;
  currentQty?: number | string;
  avgEntryPrice?: number | string;
  markPrice?: number | string;
  unrealisedPnl?: number | string;
  realLeverage?: number | string;
  leverage?: number | string;
  liquidationPrice?: number | string;
  crossMode?: boolean;
  marginMode?: string;
  openingTimestamp?: number;
}

/** Unified Trading Account: GET /api/ua/v1/unified/position/open-list. Times in nanoseconds. */
interface UnifiedOpen {
  id?: string;
  symbol: string;
  side?: string;
  size?: string;
  entryPrice?: string;
  markPrice?: string;
  unrealizedPnL?: string;
  leverage?: string;
  liquidationPrice?: string;
  marginMode?: string;
  creationTime?: number | string;
}

/**
 * KuCoin Futures: KuCoin computes positions itself. Classic accounts and Unified Trading Accounts
 * use different endpoints and formats; the mode is detected once per source. Sizes are in lots
 * and converted with each contract's multiplier.
 */
export class KucoinHistorySource implements HistorySource {
  readonly model = "POSITIONS" as const;
  readonly maxWindowMs = MAX_WINDOW_MS;
  readonly retentionMs = RETENTION_MS;
  private readonly client: KucoinClient;
  private mode: Promise<AccountMode> | undefined;
  private multipliers: Promise<Map<string, string>> | undefined;

  constructor(credentials: ApiCredentials, options: KucoinClientOptions = {}) {
    this.client = new KucoinClient(
      { ...credentials, passphrase: credentials.passphrase ?? "" },
      options,
    );
  }

  async fetchHistory(window: HistoryWindow): Promise<HistoryBatch> {
    const [mode, multipliers] = await Promise.all([this.accountMode(), this.loadMultipliers()]);
    const positions =
      mode === "UNIFIED"
        ? await this.fetchUnified(window.since.getTime(), window.until.getTime(), multipliers)
        : await this.fetchClassic(window.since.getTime(), window.until.getTime(), multipliers);
    return { fills: [], income: [], positions };
  }

  toRecords(raws: readonly RawExchangePosition[]): ExchangePositionRecord[] {
    const unified = raws.filter((r) => r.raw.mode === "UNIFIED").map(unifiedRecord);
    const classicGroups = new Map<string, RawExchangePosition[]>();
    for (const r of raws) {
      if (r.raw.mode === "UNIFIED") continue;
      const key = String((r.raw.close as ClassicClose).positionId ?? r.externalId);
      classicGroups.set(key, [...(classicGroups.get(key) ?? []), r]);
    }
    const classic = [...classicGroups.entries()].map(([positionId, group]) =>
      classicRecord(positionId, group),
    );
    return [...classic, ...unified];
  }

  async fetchOpenPositions(): Promise<OpenPositionSnapshot[]> {
    const [mode, multipliers] = await Promise.all([this.accountMode(), this.loadMultipliers()]);
    if (mode === "UNIFIED") {
      const data = await this.client.get<UnifiedOpen[] | { items?: UnifiedOpen[] }>(
        "spot",
        "/api/ua/v1/unified/position/open-list",
        { limit: 200 },
      );
      const rows = Array.isArray(data) ? data : (data?.items ?? []);
      return rows.flatMap((p) => unifiedOpen(p, multipliers.get(p.symbol) ?? null));
    }
    const rows = (await this.client.get<ClassicOpen[]>("futures", "/api/v1/positions")) ?? [];
    return rows.flatMap((p) => classicOpen(p, multipliers.get(p.symbol) ?? null));
  }

  classify(err: unknown): VerificationFailure {
    return mapKucoinFailure(err, "keyInfo");
  }

  private accountMode(): Promise<AccountMode> {
    this.mode ??= this.client
      .get<{ selfAccountMode?: string }>("spot", "/api/ua/v1/account/mode")
      .then((d) => (d?.selfAccountMode === "UNIFIED" ? "UNIFIED" : "CLASSIC") as AccountMode)
      // Accounts that predate unified accounts may not have this endpoint: they are classic.
      .catch((err: unknown) => {
        if (
          err instanceof ExchangeHttpError &&
          err.status >= 400 &&
          err.status < 500 &&
          err.status !== 429
        ) {
          return "CLASSIC" as const;
        }
        this.mode = undefined;
        throw err;
      });
    return this.mode;
  }

  private loadMultipliers(): Promise<Map<string, string>> {
    this.multipliers ??= this.client
      .publicGet<{ symbol: string; multiplier: number | string }[]>(
        "futures",
        "/api/v1/contracts/active",
      )
      .then(
        (rows) =>
          new Map((rows ?? []).map((r) => [r.symbol, String(Math.abs(Number(r.multiplier)))])),
      )
      .catch((err: unknown) => {
        this.multipliers = undefined;
        throw err;
      });
    return this.multipliers;
  }

  private async fetchClassic(
    from: number,
    to: number,
    multipliers: Map<string, string>,
  ): Promise<RawExchangePosition[]> {
    const out: RawExchangePosition[] = [];
    for (let pageId = 1; ; pageId++) {
      const data = await this.client.get<{ items?: ClassicClose[]; totalPage?: number }>(
        "futures",
        "/api/v1/history-positions",
        { from, to, limit: CLASSIC_LIMIT, pageId },
      );
      for (const c of data?.items ?? []) {
        out.push({
          externalId: `C:${c.closeId}`,
          symbol: canonicalSymbol("KUCOIN", c.symbol).symbol,
          closed: !String(c.type ?? "").includes("PARTIAL"),
          closedAt: c.closeTime ? new Date(c.closeTime) : null,
          raw: { mode: "CLASSIC", close: c, multiplier: multipliers.get(c.symbol) ?? null },
        });
      }
      if (!data?.items?.length || pageId >= (data.totalPage ?? 1)) return out;
    }
  }

  /** The unified endpoint's paging parameters are undocumented, so full pages are split by time. */
  private async fetchUnified(
    from: number,
    to: number,
    multipliers: Map<string, string>,
  ): Promise<RawExchangePosition[]> {
    const items = await this.client.get<{ items?: UnifiedClose[] }>(
      "spot",
      "/api/ua/v1/position/history",
      {
        startAt: from,
        endAt: to,
        pageSize: UTA_PAGE,
      },
    );
    const rows = items?.items ?? [];
    if (rows.length >= UTA_SPLIT_AT && to - from > MIN_SPLIT_MS) {
      const mid = Math.floor((from + to) / 2);
      const halves = [
        ...(await this.fetchUnified(from, mid, multipliers)),
        ...(await this.fetchUnified(mid + 1, to, multipliers)),
      ];
      // A record on the boundary can appear in both halves.
      return [...new Map(halves.map((r) => [r.externalId, r])).values()];
    }
    return rows.map(
      (u): RawExchangePosition => ({
        externalId: `U:${u.closeId}`,
        symbol: canonicalSymbol("KUCOIN", u.symbol).symbol,
        closed: true,
        closedAt: new Date(nanosToMs(u.closingTime)),
        raw: { mode: "UNIFIED", close: u, multiplier: multipliers.get(u.symbol) ?? null },
      }),
    );
  }
}

const num = (v: unknown): Dec | null =>
  v === undefined || v === null || v === "" ? null : dec(String(v));

/** KuCoin unified timestamps are nanoseconds; integer arithmetic avoids float precision loss. */
export function nanosToMs(value: number | string): number {
  const s = String(value);
  return /^\d{16,}$/.test(s) ? Number(BigInt(s) / 1_000_000n) : Number(s);
}

function directionOf(close: { type?: string; side?: string | null }): "LONG" | "SHORT" {
  const text = `${close.side ?? ""} ${close.type ?? ""}`.toUpperCase();
  return text.includes("SHORT") ? "SHORT" : "LONG";
}

function classicRecord(positionId: string, group: RawExchangePosition[]): ExchangePositionRecord {
  const closes = group.map((g) => g.raw.close as ClassicClose);
  const first = closes[0] as ClassicClose;
  const multiplier = stringField(group[0]?.raw, "multiplier");
  const sizes = closes.map((c) => num(c.closeSize));
  const sizesKnown = sizes.every((s) => s !== null);
  const lots = sizesKnown ? sum(sizes as Dec[]) : null;

  // Exit: size-weighted average of close prices when sizes are known.
  const priced = closes
    .map((c, i) => ({ price: num(c.closePrice), size: sizes[i] }))
    .filter(
      (x): x is { price: Dec; size: Dec } =>
        x.price !== null && x.size !== null && x.size !== undefined,
    );
  const exit =
    priced.length > 0 && sizesKnown
      ? sum(priced.map((x) => x.price.times(x.size))).div(sum(priced.map((x) => x.size)))
      : num(closes.findLast((c) => num(c.closePrice) !== null)?.closePrice);

  const net = sum(closes.map((c) => num(c.pnl) ?? ZERO));
  // realisedGrossCost is a cost: positive means a loss.
  const gross = sum(closes.map((c) => (num(c.realisedGrossCost) ?? ZERO).neg()));
  const fees = sum(closes.map((c) => num(c.tradeFee) ?? ZERO));
  const openTimes = closes.map((c) => c.openTime ?? c.closeTime ?? 0).filter((t) => t > 0);
  const closeTimes = closes.map((c) => c.closeTime ?? 0).filter((t) => t > 0);
  const closed = group.some((g) => g.closed);

  return {
    externalId: `C:${positionId}`,
    symbol: group[0]?.symbol ?? "",
    direction: directionOf(first),
    closed,
    openedAt: new Date(openTimes.length ? Math.min(...openTimes) : 0),
    closedAt: closed && closeTimes.length ? new Date(Math.max(...closeTimes)) : null,
    entryPrice: ((e) => (e ? str(e) : null))(
      num(closes.find((c) => num(c.openPrice) !== null)?.openPrice),
    ),
    exitPrice: exit ? str(exit.toDecimalPlaces(18)) : null,
    quantity: lots && multiplier ? str(lots.times(multiplier)) : null,
    leverage: num(first.leverage)?.gt(0) ? str(dec(String(first.leverage))) : null,
    grossPnl: str(gross),
    fees: str(fees),
    // Funding reconciles KuCoin's own figures: net = gross - fees + funding.
    funding: str(net.minus(gross).plus(fees)),
    netPnl: str(net),
  };
}

function unifiedRecord(raw: RawExchangePosition): ExchangePositionRecord {
  const u = raw.raw.close as UnifiedClose;
  const multiplier = stringField(raw.raw, "multiplier");
  const net = num(u.realizedPnL);
  const fees = num(u.fee);
  const funding = num(u.fundingFee);
  const lots = num(u.maxSize);
  const exit = num(u.avgClosePrice) ?? num(u.closePrice);
  return {
    externalId: raw.externalId,
    symbol: raw.symbol,
    direction: directionOf(u),
    closed: true,
    openedAt: new Date(nanosToMs(u.creationTime)),
    closedAt: new Date(nanosToMs(u.closingTime)),
    entryPrice: num(u.entryPrice) ? str(dec(String(u.entryPrice))) : null,
    exitPrice: exit ? str(exit) : null,
    quantity: lots && multiplier ? str(lots.times(multiplier)) : null,
    leverage: num(u.leverage)?.gt(0) ? str(dec(String(u.leverage))) : null,
    grossPnl: null, // derived from net, fees and funding by the engine
    fees: fees ? str(fees) : null,
    // KuCoin reports the funding fee as a cost (positive = paid); the journal stores it signed.
    funding: funding ? str(funding.neg()) : null,
    netPnl: net ? str(net) : null,
  };
}

function marginModeOf(value: string | undefined, crossMode?: boolean): "CROSS" | "ISOLATED" | null {
  const text = String(value ?? "").toUpperCase();
  if (text === "CROSS" || text === "ISOLATED") return text;
  return crossMode === undefined ? null : crossMode ? "CROSS" : "ISOLATED";
}

function classicOpen(p: ClassicOpen, multiplier: string | null): OpenPositionSnapshot[] {
  const lots = num(p.currentQty);
  if (!lots || lots.isZero() || p.isOpen === false) return [];
  const { symbol } = canonicalSymbol("KUCOIN", p.symbol);
  const direction = lots.isNegative() ? "SHORT" : "LONG";
  return [
    {
      externalId: p.id ?? `${p.symbol}:${direction}`,
      symbol,
      direction,
      // Lots are not coins: without the contract multiplier the size is unknown, not "lots".
      quantity: multiplier ? str(lots.abs().times(multiplier)) : null,
      entryPrice: positive(p.avgEntryPrice),
      markPrice: positive(p.markPrice),
      unrealizedPnl: signed(p.unrealisedPnl),
      leverage: positive(p.realLeverage ?? p.leverage),
      liquidationPrice: positive(p.liquidationPrice),
      marginMode: marginModeOf(p.marginMode, p.crossMode),
      openedAt: p.openingTimestamp ? new Date(p.openingTimestamp) : null,
    },
  ];
}

function unifiedOpen(p: UnifiedOpen, multiplier: string | null): OpenPositionSnapshot[] {
  const lots = num(p.size);
  if (!lots || lots.isZero()) return [];
  const { symbol } = canonicalSymbol("KUCOIN", p.symbol);
  const side = String(p.side ?? "").toUpperCase();
  const direction = side === "SHORT" || (side !== "LONG" && lots.isNegative()) ? "SHORT" : "LONG";
  return [
    {
      externalId: p.id ?? `${p.symbol}:${direction}`,
      symbol,
      direction,
      // Lots are not coins: without the contract multiplier the size is unknown, not "lots".
      quantity: multiplier ? str(lots.abs().times(multiplier)) : null,
      entryPrice: positive(p.entryPrice),
      markPrice: positive(p.markPrice),
      unrealizedPnl: signed(p.unrealizedPnL),
      leverage: positive(p.leverage),
      liquidationPrice: positive(p.liquidationPrice),
      marginMode: marginModeOf(p.marginMode),
      openedAt: p.creationTime ? new Date(nanosToMs(p.creationTime)) : null,
    },
  ];
}
