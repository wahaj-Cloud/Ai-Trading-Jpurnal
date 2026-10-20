import { READOUT_RULES } from "./cockpit.js";
import { signedPct } from "./numbers.js";
import {
  type AcrossCell,
  type FlowStrength,
  ORDERFLOW_MIN_MOVE,
  ORDERFLOW_WINDOW_LABEL,
  type OrderflowCoinDto,
  type OrderflowWindow,
  REGIME_INFO,
  REGIMES,
  type Regime,
  STRENGTH_LABEL,
  STRENGTH_THRESHOLDS,
  UNUSUAL_VOLUME,
} from "./orderflow.js";

/**
 * Plain-language reads of the Order Flow figures: what the numbers say, by fixed rules, in words a
 * trader can act on. Every sentence describes what happened; none of them is a forecast or a
 * signal. Kept here so the page, tests and any future export say exactly the same thing.
 */

export type ReadTone = "up" | "down" | "neutral" | "warn";
export interface ReadPoint {
  tone: ReadTone;
  text: string;
}

const compactUsd = (v: number) =>
  `$${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(Math.abs(v))}`;
const signed = (v: number, digits = 1) => signedPct(v, digits);
const fundingText = (f: number) => signed(f * 100, 4);

// ─── Market breadth ───

/** One side leads the market when at least this share of coins traded net that way. */
export const BREADTH_LEAD = 60;

/** Share of coins (with any net flow) where market buys beat market sells; null when none. */
export function breadthPct(buying: number, selling: number): number | null {
  const total = buying + selling;
  return total > 0 ? (buying / total) * 100 : null;
}

export type MarketLean = "up" | "down" | "mixed";
export const MARKET_LEAN_LABEL: Record<MarketLean, string> = {
  up: "Buyers more active",
  down: "Sellers more active",
  mixed: "Balanced",
};

/**
 * Which side led the market: the breadth beyond 60/40 and the dollar total agreeing with it.
 * When the count and the dollars disagree (many small coins buying, the big ones selling) it is
 * mixed.
 */
export function marketLean(buying: number, selling: number, netFlowUsd: number): MarketLean {
  const b = breadthPct(buying, selling);
  if (b === null) return "mixed";
  if (b >= BREADTH_LEAD && netFlowUsd > 0) return "up";
  if (b <= 100 - BREADTH_LEAD && netFlowUsd < 0) return "down";
  return "mixed";
}

// ─── Absorption: price moving against the market orders ───

export const DIVERGENCES = [
  "up_on_selling",
  "down_on_buying",
  "buying_absorbed",
  "selling_absorbed",
] as const;
export type Divergence = (typeof DIVERGENCES)[number];
export const DIVERGENCE_INFO: Record<
  Divergence,
  { label: string; tone: ReadTone; meaning: string }
> = {
  up_on_selling: {
    label: "Rose on selling",
    tone: "up",
    meaning:
      "Price rose even though market orders sold more than they bought: resting (limit) buy orders soaked up the selling.",
  },
  down_on_buying: {
    label: "Fell on buying",
    tone: "down",
    meaning:
      "Price fell even though market orders bought more than they sold: resting (limit) sell orders soaked up the buying.",
  },
  buying_absorbed: {
    label: "Buying absorbed",
    tone: "warn",
    meaning:
      "Heavy market buying but price barely moved: sellers are meeting every buy at this level.",
  },
  selling_absorbed: {
    label: "Selling absorbed",
    tone: "warn",
    meaning:
      "Heavy market selling but price barely moved: buyers are meeting every sell at this level.",
  },
};

/**
 * Price and taker flow disagreeing. A real price move (beyond the window's "too small to read"
 * size) against buying or selling pressure, or strong pressure with no real price move.
 */
export function divergenceOf(
  c: Pick<OrderflowCoinDto, "priceChangePct" | "buyPressurePct">,
  window: OrderflowWindow,
): Divergence | null {
  const move = ORDERFLOW_MIN_MOVE[window].price;
  const t = STRENGTH_THRESHOLDS[window];
  const p = c.priceChangePct;
  const f = c.buyPressurePct;
  if (p >= move && f <= -t.lean) return "up_on_selling";
  if (p <= -move && f >= t.lean) return "down_on_buying";
  if (Math.abs(p) < move && f >= t.strong) return "buying_absorbed";
  if (Math.abs(p) < move && f <= -t.strong) return "selling_absorbed";
  return null;
}

// ─── Funding and activity ───

export type FundingState = "longs_crowded" | "shorts_crowded";
/** Same thresholds as the Scalp Cockpit: ≥ +0.03% longs pay a lot, ≤ −0.01% shorts pay. */
export function fundingStateOf(f: number | null): FundingState | null {
  if (f === null) return null;
  if (f >= READOUT_RULES.fundingHigh) return "longs_crowded";
  if (f <= READOUT_RULES.fundingLow) return "shorts_crowded";
  return null;
}
/** Relative volume at or below this is quiet. */
export const QUIET_VOLUME = 0.5;
/**
 * Relative volume to one decimal, rounded down so a shown "2.5×" always means it reached the
 * unusual line (2.49 shows as 2.4×).
 */
export const relVolumeText = (v: number) => `${(Math.floor(v * 10 + 1e-9) / 10).toFixed(1)}×`;

// ─── Across timeframes ───

/** The scalping stack: the three windows a short-term trader lines up. */
export const ALIGN_WINDOWS = ["5m", "15m", "1h"] as const satisfies readonly OrderflowWindow[];
export type FlowAlignment = "up" | "down" | "conflict" | "mixed";
export const ALIGNMENT_TEXT: Record<FlowAlignment, string> = {
  up: "Lined up: buying",
  down: "Lined up: selling",
  conflict: "Pulling apart",
  mixed: "Partly neutral",
};
export const strengthSign = (s: FlowStrength): -1 | 0 | 1 =>
  s === "buying" || s === "strong_buying" ? 1 : s === "selling" || s === "strong_selling" ? -1 : 0;

/**
 * 5m, 15m and 1H together: all buying (or strong buying) is lined up, all selling likewise; one
 * buying and another selling is pulling apart; anything else (a neutral or a missing window) is
 * partly neutral.
 */
export function alignmentOf(cells: Partial<Record<OrderflowWindow, AcrossCell>>): FlowAlignment {
  const signs = ALIGN_WINDOWS.map((w) => {
    const c = cells[w];
    return c ? strengthSign(c.s) : null;
  });
  if (signs.every((s) => s === 1)) return "up";
  if (signs.every((s) => s === -1)) return "down";
  if (signs.includes(1) && signs.includes(-1)) return "conflict";
  return "mixed";
}

// ─── Reads ───

export interface MarketReadInput {
  window: OrderflowWindow;
  coins: OrderflowCoinDto[];
  buying: number;
  selling: number;
  netFlowUsd: number;
}
export interface MarketRead {
  lean: MarketLean;
  breadth: number | null;
  headline: string;
  points: ReadPoint[];
  /** Coins opening positions (long or short build-up) vs closing them, among the shown coins. */
  opening: number;
  closing: number;
  oiNetUsd: number | null;
  unusual: number;
  absorbing: number;
  longsCrowded: number;
  shortsCrowded: number;
}

/** The whole market in a few sentences: who led, whether money came in, what stands out. */
export function marketRead(x: MarketReadInput): MarketRead {
  const label = ORDERFLOW_WINDOW_LABEL[x.window];
  const lean = marketLean(x.buying, x.selling, x.netFlowUsd);
  const breadth = breadthPct(x.buying, x.selling);
  const points: ReadPoint[] = [];
  const total = x.buying + x.selling;
  const counts = Object.fromEntries(REGIMES.map((r) => [r, 0])) as Record<Regime, number>;
  for (const c of x.coins) counts[c.regime]++;
  const opening = counts.long_buildup + counts.short_buildup;
  const closing = counts.short_covering + counts.long_unwinding;
  const withOi = x.coins.filter((c) => c.oiChangeUsd !== null);
  const oiNetUsd = withOi.length ? withOi.reduce((s, c) => s + (c.oiChangeUsd ?? 0), 0) : null;
  const unusual = x.coins.filter((c) => (c.relVolume ?? 0) >= UNUSUAL_VOLUME).length;
  const absorbing = x.coins.filter((c) => divergenceOf(c, x.window) !== null).length;
  const longsCrowded = x.coins.filter((c) => fundingStateOf(c.funding) === "longs_crowded").length;
  const shortsCrowded = x.coins.filter(
    (c) => fundingStateOf(c.funding) === "shorts_crowded",
  ).length;

  if (total > 0)
    points.push({
      tone: lean === "mixed" ? "neutral" : lean,
      text: `${x.buying} of ${total} coins had more market buying than selling over the last ${label} (${Math.round(breadth ?? 0)}%).`,
    });
  if (x.netFlowUsd !== 0)
    points.push({
      tone: x.netFlowUsd > 0 ? "up" : "down",
      text: `In dollars, market orders ${x.netFlowUsd > 0 ? "bought" : "sold"} ${compactUsd(x.netFlowUsd)} more than they ${x.netFlowUsd > 0 ? "sold" : "bought"} across all coins.`,
    });
  if (oiNetUsd !== null && oiNetUsd !== 0)
    points.push({
      tone: "neutral",
      text:
        oiNetUsd > 0
          ? `Open interest rose by ${compactUsd(oiNetUsd)} in the shown coins: more positions opened than closed, so new money came in.`
          : `Open interest fell by ${compactUsd(oiNetUsd)} in the shown coins: more positions closed than opened, so money left.`,
    });
  if (opening + closing > 0) {
    const top = (["long_buildup", "short_buildup", "short_covering", "long_unwinding"] as const)
      .map((r) => [r, counts[r]] as const)
      .sort((a, b) => b[1] - a[1])[0] as readonly [Regime, number];
    points.push({
      tone: top[0] === "long_buildup" || top[0] === "short_covering" ? "up" : "down",
      text: `Most common pattern: ${REGIME_INFO[top[0]].label} in ${top[1]} coins. ${REGIME_INFO[top[0]].meaning}`,
    });
    if (opening !== closing)
      points.push({
        tone: "neutral",
        text:
          opening > closing
            ? `${opening} coins are adding positions and ${closing} are closing them: the moves are mostly backed by new money.`
            : `${closing} coins are closing positions and ${opening} are adding them: much of the movement is traders exiting, not new money.`,
      });
  }
  if (longsCrowded > 0 || shortsCrowded > 0)
    points.push({
      tone: "warn",
      text: [
        longsCrowded > 0 &&
          `${longsCrowded} coin${longsCrowded === 1 ? "" : "s"} with high funding (longs paying ${fundingText(READOUT_RULES.fundingHigh)} or more)`,
        shortsCrowded > 0 && `${shortsCrowded} with negative funding (shorts paying)`,
      ]
        .filter(Boolean)
        .join(" and ")
        .concat(": a crowded side is the one that gets squeezed when price turns."),
    });
  if (unusual > 0)
    points.push({
      tone: "warn",
      text: `${unusual} coin${unusual === 1 ? " is" : "s are"} trading at ${UNUSUAL_VOLUME}× or more their usual pace: something is drawing attention there.`,
    });
  if (absorbing > 0)
    points.push({
      tone: "warn",
      text: `${absorbing} coin${absorbing === 1 ? " shows" : "s show"} price moving against the market orders (absorption): resting orders are taking the other side.`,
    });

  const headline =
    lean === "up"
      ? `Buyers more active: market buying led in ${Math.round(breadth ?? 0)}% of coins`
      : lean === "down"
        ? `Sellers more active: market selling led in ${Math.round(100 - (breadth ?? 0))}% of coins`
        : "Balanced: neither side leads across the market";
  return {
    lean,
    breadth,
    headline,
    points,
    opening,
    closing,
    oiNetUsd,
    unusual,
    absorbing,
    longsCrowded,
    shortsCrowded,
  };
}

const ALIGN_LABEL: Record<(typeof ALIGN_WINDOWS)[number], string> = {
  "5m": "5m",
  "15m": "15m",
  "1h": "1H",
};

/** One coin in plain language: flow, positions, absorption, funding, activity, timeframes. */
export function coinRead(
  c: OrderflowCoinDto,
  window: OrderflowWindow,
  across?: Partial<Record<OrderflowWindow, AcrossCell>>,
): ReadPoint[] {
  const label = ORDERFLOW_WINDOW_LABEL[window];
  const t = STRENGTH_THRESHOLDS[window];
  const out: ReadPoint[] = [];
  const s = strengthSign(c.strength);
  out.push({
    tone: s > 0 ? "up" : s < 0 ? "down" : "neutral",
    text: `Market orders: ${STRENGTH_LABEL[c.strength]}. Net ${signed(c.buyPressurePct)} of all trading over ${label} (${label} counts ±${t.lean}% as buying or selling and ±${t.strong}% as strong).`,
  });
  if (c.oiChangePct === null)
    out.push({ tone: "neutral", text: "Open interest is not available for this coin right now." });
  else {
    const info = REGIME_INFO[c.regime];
    out.push({
      tone:
        c.regime === "long_buildup" || c.regime === "short_covering"
          ? "up"
          : c.regime === "neutral"
            ? "neutral"
            : "down",
      text:
        c.regime === "neutral"
          ? `Positions: price ${signed(c.priceChangePct, 2)}, open interest ${signed(c.oiChangePct, 2)}: too small a move to read.`
          : `Positions: ${info.label} (${info.rule.toLowerCase()}). ${info.meaning}`,
    });
  }
  const d = divergenceOf(c, window);
  if (d) out.push({ tone: DIVERGENCE_INFO[d].tone, text: DIVERGENCE_INFO[d].meaning });
  const fs = fundingStateOf(c.funding);
  if (fs && c.funding !== null)
    out.push({
      tone: "warn",
      text:
        fs === "longs_crowded"
          ? `Funding ${fundingText(c.funding)}: longs are paying shorts a high rate to stay in, so the long side is crowded.`
          : `Funding ${fundingText(c.funding)}: shorts are paying longs, so the short side is crowded.`,
    });
  if (c.relVolume !== null && c.relVolume >= UNUSUAL_VOLUME)
    out.push({
      tone: "warn",
      text: `Trading at ${relVolumeText(c.relVolume)} its usual pace: unusual activity. Check the news before acting on it.`,
    });
  else if (c.relVolume !== null && c.relVolume <= QUIET_VOLUME)
    out.push({
      tone: "neutral",
      text: `Quiet: ${relVolumeText(c.relVolume)} its usual pace. Flow on thin trading can flip quickly.`,
    });
  if (across) {
    const a = alignmentOf(across);
    const parts = ALIGN_WINDOWS.map((w) => {
      const cell = across[w];
      return `${ALIGN_LABEL[w]} ${cell ? STRENGTH_LABEL[cell.s].toLowerCase() : "n/a"}`;
    }).join(", ");
    out.push({
      tone: a === "up" ? "up" : a === "down" ? "down" : a === "conflict" ? "warn" : "neutral",
      text:
        a === "up" || a === "down"
          ? `5m, 15m and 1H all lean the same way (${parts}): short-term and hourly flow agree.`
          : a === "conflict"
            ? `Timeframes pull apart (${parts}): the short-term flow is going against the bigger one.`
            : `Timeframes partly neutral (${parts}).`,
    });
  }
  return out;
}
