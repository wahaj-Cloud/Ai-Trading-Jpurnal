import type { AcrossCell, OrderflowWindow } from "./orderflow.js";
import { ORDERFLOW_SPEC, ORDERFLOW_WINDOWS } from "./orderflow.js";

/**
 * The market at a glance (Order Flow's "river" view): how many coins are up and down, how each
 * sector is doing, every coin's path since the window started, and where one coin ranks. Pure
 * functions over the Order Flow scan, so the page, tests and an independent check agree.
 */

export const SECTORS = {
  majors: "Bitcoin & Ether",
  layer1: "Layer 1",
  payments: "Payments",
  layer2: "Layer 2",
  defi: "DeFi",
  ai: "AI & data",
  memes: "Memes",
  infra: "Exchange & infra",
  gaming: "Gaming",
  rwa: "Real-world assets",
  metals: "Gold & silver",
  other: "Other",
} as const;
export type Sector = keyof typeof SECTORS;

const MEMBERS: Record<Exclude<Sector, "other">, string[]> = {
  majors: ["BTC", "ETH"],
  layer1: [
    "SOL",
    "ADA",
    "AVAX",
    "DOT",
    "TRX",
    "TON",
    "NEAR",
    "APT",
    "SUI",
    "SEI",
    "ATOM",
    "ICP",
    "ALGO",
    "HBAR",
    "INJ",
    "TIA",
    "KAS",
    "EGLD",
    "FTM",
    "S",
    "XTZ",
    "EOS",
    "NEO",
    "ETC",
    "VET",
    "KAIA",
    "BERA",
    "HYPE",
    "MOVE",
    "IOTA",
    "QNT",
    "XDC",
    "THETA",
    "FLOW",
    "ROSE",
    "MINA",
    "CFX",
    "ZIL",
  ],
  payments: ["XRP", "XLM", "LTC", "BCH", "XMR", "ZEC", "DASH"],
  layer2: [
    "ARB",
    "OP",
    "POL",
    "MATIC",
    "STRK",
    "MNT",
    "IMX",
    "ZK",
    "BLAST",
    "METIS",
    "MANTA",
    "SCR",
    "STX",
    "CELO",
    "LINEA",
  ],
  defi: [
    "UNI",
    "AAVE",
    "MKR",
    "CRV",
    "LDO",
    "DYDX",
    "SUSHI",
    "COMP",
    "SNX",
    "PENDLE",
    "JUP",
    "RAY",
    "ENA",
    "ETHFI",
    "GMX",
    "1INCH",
    "CAKE",
    "JTO",
    "EIGEN",
    "MORPHO",
    "SKY",
    "RUNE",
    "CVX",
    "LQTY",
    "BAL",
    "YFI",
    "AERO",
  ],
  ai: [
    "FET",
    "RENDER",
    "TAO",
    "WLD",
    "AGIX",
    "OCEAN",
    "ARKM",
    "GRT",
    "AI16Z",
    "VIRTUAL",
    "AIXBT",
    "IO",
    "NMR",
    "AKT",
    "GRASS",
    "KAITO",
  ],
  memes: [
    "DOGE",
    "SHIB",
    "PEPE",
    "WIF",
    "BONK",
    "FLOKI",
    "BOME",
    "MEME",
    "TRUMP",
    "POPCAT",
    "PNUT",
    "NEIRO",
    "BRETT",
    "MOODENG",
    "FARTCOIN",
    "TURBO",
    "MEW",
    "PENGU",
    "SPX",
    "GOAT",
    "ACT",
    "DOGS",
    "NOT",
    "PEOPLE",
    "MOG",
    "BABYDOGE",
    "SATS",
    "ORDI",
  ],
  infra: [
    "BNB",
    "OKB",
    "LINK",
    "PYTH",
    "FIL",
    "AR",
    "ENS",
    "W",
    "ZRO",
    "TRB",
    "API3",
    "BAND",
    "LPT",
    "STORJ",
    "HNT",
    "JASMY",
    "IOTX",
    "ANKR",
    "SSV",
  ],
  gaming: [
    "AXS",
    "SAND",
    "MANA",
    "GALA",
    "APE",
    "ENJ",
    "ILV",
    "PIXEL",
    "BEAM",
    "YGG",
    "MAGIC",
    "PRIME",
    "SUPER",
    "XAI",
    "RON",
  ],
  rwa: ["ONDO", "OM", "POLYX", "PLUME", "CFG", "TRU"],
  metals: ["XAU", "XAG", "PAXG", "XAUT"],
};
const SECTOR_OF = new Map<string, Sector>();
for (const [s, list] of Object.entries(MEMBERS) as Array<[Sector, string[]]>)
  for (const b of list) if (!SECTOR_OF.has(b)) SECTOR_OF.set(b, s);

/** The base asset of a futures symbol ("1000PEPEUSDT" → "PEPE"). */
export const futuresBase = (symbol: string) =>
  symbol.replace(/USDT$|USDC$/, "").replace(/^1000+(?=[A-Z])|^1M(?=[A-Z])/, "");

export const sectorOf = (symbol: string): Sector => SECTOR_OF.get(futuresBase(symbol)) ?? "other";

export interface MapCoin {
  symbol: string;
  priceChangePct: number;
  volumeUsd: number;
}

export interface Breadth {
  up: number;
  down: number;
  /** Moves under 0.01% either way. */
  flat: number;
  medianPct: number | null;
  /** Average move, each coin weighted by its traded value in the window. */
  weightedPct: number | null;
}

export const FLAT_PCT = 0.01;

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

export function breadthOf(coins: readonly MapCoin[]): Breadth {
  let up = 0;
  let down = 0;
  let flat = 0;
  let vol = 0;
  let wsum = 0;
  for (const c of coins) {
    if (c.priceChangePct >= FLAT_PCT) up++;
    else if (c.priceChangePct <= -FLAT_PCT) down++;
    else flat++;
    if (c.volumeUsd > 0) {
      vol += c.volumeUsd;
      wsum += c.volumeUsd * c.priceChangePct;
    }
  }
  return {
    up,
    down,
    flat,
    medianPct: median(coins.map((c) => c.priceChangePct)),
    weightedPct: vol > 0 ? wsum / vol : null,
  };
}

export interface SectorRow extends Breadth {
  sector: Sector;
  label: string;
  count: number;
  /** Simple average move of the sector's coins. */
  avgPct: number;
  /** The sector's biggest mover either way. */
  leader: { symbol: string; pct: number } | null;
}

/** Each sector present among the coins, strongest average move first. */
export function sectorRows(coins: readonly MapCoin[]): SectorRow[] {
  const groups = new Map<Sector, MapCoin[]>();
  for (const c of coins) {
    const s = sectorOf(c.symbol);
    groups.set(s, [...(groups.get(s) ?? []), c]);
  }
  const rows: SectorRow[] = [];
  for (const [sector, list] of groups) {
    const leader = list.reduce<MapCoin | null>(
      (best, c) => (!best || Math.abs(c.priceChangePct) > Math.abs(best.priceChangePct) ? c : best),
      null,
    );
    rows.push({
      sector,
      label: SECTORS[sector],
      count: list.length,
      avgPct: list.reduce((s, c) => s + c.priceChangePct, 0) / list.length,
      leader: leader ? { symbol: leader.symbol, pct: leader.priceChangePct } : null,
      ...breadthOf(list),
    });
  }
  return rows.sort((a, b) => b.avgPct - a.avgPct || a.sector.localeCompare(b.sector));
}

/**
 * A coin's path in % from the window start, ending with its live move when that differs from the
 * last scanned point (the forming candle).
 */
export function riverPath(series: readonly number[], livePct: number): number[] {
  const out = [...series];
  if (out.length === 0 || Math.abs((out.at(-1) as number) - livePct) > 1e-9) out.push(livePct);
  return out;
}

/** The middle coin at each step (paths aligned at their right end, the present). */
export function medianPath(paths: ReadonlyArray<readonly number[]>): number[] {
  const len = Math.max(0, ...paths.map((p) => p.length));
  const out: number[] = [];
  for (let k = 0; k < len; k++) {
    const vals = paths
      .map((p) => p[p.length - len + k])
      .filter((v): v is number => typeof v === "number");
    out.push(median(vals) ?? 0);
  }
  return out;
}

/** Where a coin's move ranks: #1 = biggest rise. Percentile = share of coins it moved more than. */
export function moveRank(
  coins: readonly MapCoin[],
  symbol: string,
): { rank: number; of: number; percentile: number } | null {
  const sorted = [...coins].sort(
    (a, b) => b.priceChangePct - a.priceChangePct || a.symbol.localeCompare(b.symbol),
  );
  const i = sorted.findIndex((c) => c.symbol === symbol);
  if (i < 0) return null;
  const me = sorted[i] as MapCoin;
  const below = coins.filter((c) => c.priceChangePct < me.priceChangePct).length;
  return {
    rank: i + 1,
    of: coins.length,
    percentile: coins.length > 1 ? (below / (coins.length - 1)) * 100 : 100,
  };
}

/**
 * How many timeframes' buy pressure leans the same way as the chosen one (out of those with a
 * reading). A count of agreement, not a forecast.
 */
export function flowAgreement(
  cells: Partial<Record<OrderflowWindow, AcrossCell>>,
  window: OrderflowWindow,
): { same: number; of: number; side: "buying" | "selling" | null } {
  const mine = cells[window];
  const side = !mine || mine.p === 0 ? null : mine.p > 0 ? "buying" : "selling";
  let same = 0;
  let of = 0;
  for (const w of ORDERFLOW_WINDOWS) {
    const c = cells[w];
    if (!c) continue;
    of++;
    if (side && Math.sign(c.p) === (side === "buying" ? 1 : -1)) same++;
  }
  return { same, of, side };
}

// ─── Replay ───

/**
 * The market as it stood `back` points before now: each coin's move at that point of its path
 * (paths aligned at their right end, the present). Coins whose path does not reach back that far
 * are left out. Traded value stays the whole window's, so weights do not jump while scrubbing.
 */
export function replayCoins<T extends MapCoin>(
  coins: ReadonlyArray<T & { path: readonly number[] }>,
  back: number,
): T[] {
  const out: T[] = [];
  for (const c of coins) {
    const v = c.path[c.path.length - 1 - back];
    if (typeof v === "number") out.push({ ...c, priceChangePct: v });
  }
  return out;
}

/**
 * When point `i` of a window's `n`-point series closed (ms): the series is the window's candles
 * spread evenly from the first to the last (see `downsample`), each point a candle's close.
 */
export function seriesPointTime(window: OrderflowWindow, asOf: number, i: number, n: number) {
  const { candles, candleMs } = ORDERFLOW_SPEC[window];
  const idx = n <= 1 ? candles - 1 : n >= candles ? i : Math.round((i * (candles - 1)) / (n - 1));
  return asOf - candles * candleMs + (idx + 1) * candleMs;
}

// ─── Sectors in setups ───

/** Sectors a setup can watch (every named group; "Other" is not a group). */
export const SETUP_SECTORS = Object.keys(MEMBERS) as Array<Exclude<Sector, "other">>;
export type SetupSector = (typeof SETUP_SECTORS)[number];
/** Coins one sector adds to a setup at most (the most traded first). */
export const SECTOR_SETUP_MAX_COINS = 25;

/** A sector's coins among the exchange's listings, most traded first, at most `max`. */
export function sectorSymbols(
  sector: SetupSector,
  listings: ReadonlyArray<{ symbol: string; quoteVolume: number }>,
  max = SECTOR_SETUP_MAX_COINS,
): string[] {
  return listings
    .filter((l) => l.symbol.endsWith("USDT") && sectorOf(l.symbol) === sector)
    .sort((a, b) => b.quoteVolume - a.quoteVolume || a.symbol.localeCompare(b.symbol))
    .slice(0, max)
    .map((l) => l.symbol);
}

/** A few of a sector's best-known coins, for the setup form. */
export const sectorExamples = (sector: SetupSector, n = 4) => MEMBERS[sector].slice(0, n);
