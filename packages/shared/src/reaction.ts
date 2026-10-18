import type { EconomicEventDto } from "./economic.js";

/**
 * How markets usually react to a release, from what kind of number it is. These are the textbook
 * first reactions traders watch for, not predictions: the surprise versus the forecast moves price,
 * and the first minutes often whipsaw. US releases also move crypto and gold, because a stronger
 * dollar and higher rate expectations weigh on both.
 */
export type ReactionDirection = "up" | "down" | "mixed";

export interface MarketMove {
  market: string;
  dir: ReactionDirection;
}

export interface Reaction {
  kind: ReleaseKind;
  /** One-line explanation of why this release matters. */
  why: string;
  /** Typical moves when the number comes in above the forecast (or the tone is hawkish). */
  higher: MarketMove[];
  /** …below the forecast (or dovish). */
  lower: MarketMove[];
  /** Labels for the two scenarios. */
  higherLabel: string;
  lowerLabel: string;
  /** Once the actual is out: which scenario happened, if it can be told. */
  outcome: "higher" | "lower" | "inline" | null;
}

export type ReleaseKind =
  | "inflation"
  | "jobs"
  | "unemployment"
  | "growth"
  | "rates"
  | "speech"
  | "other";

const RULES: Array<{ kind: ReleaseKind; match: RegExp }> = [
  // Order matters: "Unemployment Claims" is unemployment, not jobs.
  { kind: "unemployment", match: /unemployment|jobless|claimant|claims/i },
  {
    kind: "speech",
    match:
      /speaks|speech|testif|press conference|minutes|statement|monetary policy report|hearing/i,
  },
  {
    kind: "rates",
    match:
      /rate decision|interest rate|funds rate|cash rate|bank rate|official bank rate|policy rate|refinancing rate|rate statement/i,
  },
  { kind: "inflation", match: /\bcpi\b|\bppi\b|\bpce\b|inflation|price index|prices/i },
  {
    kind: "jobs",
    match:
      /non-?farm|nfp|employment change|adp|jolts|job openings|payrolls|average (hourly )?earnings|wage/i,
  },
  {
    kind: "growth",
    match:
      /gdp|retail sales|pmi|ism|industrial production|manufacturing|durable goods|consumer confidence|sentiment|housing|home sales|building permits|business confidence|trade balance|factory orders|spending/i,
  },
];

const WHY: Record<ReleaseKind, string> = {
  inflation:
    "Inflation decides interest rates. Hotter inflation means rates stay higher for longer.",
  jobs: "A strong jobs market keeps the central bank cautious about cutting rates.",
  unemployment: "Rising unemployment or claims points to a weaker economy and earlier rate cuts.",
  growth: "Shows how fast the economy is growing; strong data supports the currency.",
  rates: "The interest-rate decision itself. The surprise and the guidance move markets most.",
  speech: "No number: the market reacts to the tone. Watch for hints about future rate moves.",
  other: "A better-than-expected number usually supports the currency.",
};

/** Markets beyond the currency itself that react to US data. */
const USD_LINKED = ["Crypto (BTC)", "Gold"];

function moves(currency: string, strong: boolean): MarketMove[] {
  const cur: MarketMove = { market: currency, dir: strong ? "up" : "down" };
  if (currency !== "USD") return [cur];
  return [
    cur,
    ...USD_LINKED.map((m) => ({ market: m, dir: (strong ? "down" : "up") as ReactionDirection })),
  ];
}

/** "0.3%", "227K", "-1.2M", "<0.10%" → number in a common unit (null when unreadable). */
export function parseFigure(v: string | null): number | null {
  if (!v) return null;
  const m = v.replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*([KMBT])?/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[(m[2] ?? "").toUpperCase()] ?? 1;
  return Number(m[1]) * mult;
}

export function marketReaction(
  e: Pick<EconomicEventDto, "title" | "currency" | "actual" | "forecast">,
): Reaction {
  const kind = RULES.find((r) => r.match.test(e.title))?.kind ?? "other";
  const cur = e.currency === "ALL" ? "USD" : e.currency;
  // For unemployment, a higher number is the weak scenario.
  const higherIsStrong = kind !== "unemployment";
  const speech = kind === "speech";
  const actual = parseFigure(e.actual);
  const forecast = parseFigure(e.forecast);
  const outcome =
    speech || actual === null || forecast === null
      ? null
      : actual > forecast
        ? "higher"
        : actual < forecast
          ? "lower"
          : "inline";
  return {
    kind,
    why: WHY[kind],
    higher: moves(cur, higherIsStrong),
    lower: moves(cur, !higherIsStrong),
    higherLabel: speech
      ? "Hawkish (rates higher for longer)"
      : kind === "rates"
        ? "Higher rate / hawkish"
        : e.forecast
          ? `Above ${e.forecast}`
          : "Higher than expected",
    lowerLabel: speech
      ? "Dovish (cuts sooner)"
      : kind === "rates"
        ? "Lower rate / dovish"
        : e.forecast
          ? `Below ${e.forecast}`
          : "Lower than expected",
    outcome,
  };
}
