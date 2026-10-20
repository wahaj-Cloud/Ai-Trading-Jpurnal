import { z } from "zod";

/**
 * Market-moving headlines: world events (war, pandemics, crises), central banks, economic data,
 * crypto and markets, from several sources. Each headline is sorted into one folder and rated
 * High / Medium / Low by fixed rules written below, so the same headline always gets the same
 * rating and every rating can be explained.
 */

export const NEWS_CATEGORIES = ["world", "central-banks", "economy", "crypto", "markets"] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];
export const NEWS_CATEGORY_INFO: Record<NewsCategory, { label: string; about: string }> = {
  world: {
    label: "World & geopolitics",
    about:
      "Wars, attacks, pandemics, disasters, sanctions, tariffs, elections and political crises.",
  },
  "central-banks": {
    label: "Central banks & FOMC",
    about: "The Fed (FOMC), ECB, Bank of Japan, Bank of England and other central banks.",
  },
  economy: {
    label: "Economy",
    about: "Inflation, jobs, growth and other economic data, and recession news.",
  },
  crypto: {
    label: "Crypto",
    about: "Regulation, ETFs, exchanges, hacks, stablecoins and the biggest coins.",
  },
  markets: { label: "Markets", about: "Stocks, commodities, currencies and companies." },
};

export const NEWS_IMPACTS = ["HIGH", "MEDIUM", "LOW"] as const;
export type NewsImpact = (typeof NEWS_IMPACTS)[number];

export const NEWS_SOURCES = ["FINNHUB", "TRADINGECONOMICS", "FED", "ECB", "GDELT"] as const;
export type NewsSource = (typeof NEWS_SOURCES)[number];
export const NEWS_SOURCE_LABEL: Record<NewsSource, string> = {
  FINNHUB: "Finnhub",
  TRADINGECONOMICS: "Trading Economics",
  FED: "Federal Reserve (official)",
  ECB: "European Central Bank (official)",
  GDELT: "GDELT world monitor",
};

/** How price moved after a high-impact headline (%, from the minute it was published). */
export interface NewsReactionDto {
  btc15m: number | null;
  btc60m: number | null;
  gold15m: number | null;
  gold60m: number | null;
}

export interface NewsItemDto {
  id: string;
  source: NewsSource;
  /** The newsroom that wrote it (Reuters, CNBC, Federal Reserve, …). */
  publisher: string;
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: string;
  category: NewsCategory;
  impact: NewsImpact;
  tags: string[];
  /** One plain sentence on why traders watch this kind of news. */
  why: string | null;
  /** Other sources reporting the same story. */
  alsoReportedBy: number;
  reaction: NewsReactionDto | null;
}

export interface NewsPageDto {
  items: NewsItemDto[];
  nextCursor: string | null;
}

export const NEWS_LIVE_CHANNEL = "news:live";
export interface NewsLiveUpdate {
  type: "headline";
  item: NewsItemDto;
}

export const newsQuerySchema = z
  .object({
    /** "top" = high-impact from every folder. */
    folder: z.enum(["top", ...NEWS_CATEGORIES]).default("top"),
    impact: z.enum(["HIGH", "MEDIUM", "ALL"]).default("ALL"),
    /** "<time ms>:<id>" of the last row of the previous page. */
    cursor: z
      .string()
      .regex(/^\d{1,15}:[0-9a-f-]{36}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(40),
  })
  .strict();
export type NewsQuery = z.infer<typeof newsQuerySchema>;

/** Headlines are kept this long. */
export const NEWS_RETENTION_DAYS = 30;

// ─── Rules ───

interface Rule {
  tag: string;
  /** Any of these matching counts. */
  re: RegExp | RegExp[];
  category: NewsCategory;
  impact: NewsImpact;
  why: string;
  /** Without this also in the headline, the rule only counts as Medium. */
  highOnlyWith?: RegExp;
}

const W = (s: string) => new RegExp(`\\b(?:${s})\\b`, "i");

/**
 * The rules, most specific first. A headline gets the highest impact of every rule it matches;
 * its folder comes from the most important matching rule (central banks and crypto win ties, so a
 * Fed decision never lands under "world").
 */
export const NEWS_RULES: Rule[] = [
  // Central banks
  {
    tag: "rate-decision",
    re: W(
      "(?:raises|raised|hikes|hiked|cuts|slashes|slashed|trims|trimmed|lowers|lowered|holds|held|keeps|kept|leaves|left|maintains|maintained)(?: its| key| benchmark| interest| policy)* rates?(?: steady| unchanged)?|rate (?:decision|hike|cut)s?|(?:fomc|monetary policy) statement|emergency (?:rate|cut|meeting)|\\d+ ?(?:bps|basis[- ]points?) (?:cut|hike|rise|increase|reduction)",
    ),
    category: "central-banks",
    impact: "HIGH",
    highOnlyWith: W(
      "fed|fomc|federal reserve|powell|ecb|lagarde|european central bank|bank of japan|boj|bank of england|boe|pboc|people's bank of china",
    ),
    why: "Interest-rate decisions reprice every market at once; surprises move crypto, gold and the dollar within minutes.",
  },
  {
    tag: "central-bank",
    // "Fed" in capitals only, so "fed up" or "fed into" never count.
    re: [
      /\bFed\b/,
      W(
        "fomc|federal reserve|the fed|fed(?:'s)? (?:chair|governor|officials?|minutes)|powell|ecb|lagarde|bank of japan|boj|ueda|bank of england|boe|bailey|pboc|people's bank of china|swiss national bank|snb|rba|reserve bank|quantitative (?:easing|tightening)|dot plot",
      ),
    ],
    category: "central-banks",
    impact: "MEDIUM",
    why: "Central-bank comments shift expectations for interest rates, which drive risk appetite.",
  },
  // Crypto
  {
    tag: "crypto-shock",
    re: W(
      "(?:exchange|protocol|bridge|wallet|defi)s? (?:hack(?:ed)?|exploit(?:ed)?|breach(?:ed)?)|hack(?:ed|ers?)? (?:of|on|at) [a-z0-9]+ (?:exchange|protocol|bridge)|(?:exchange|crypto lender|stablecoin) (?:collapse|insolven\\w*|bankrupt\\w*|halts? withdrawals)|halts? withdrawals|depeg(?:ged|s)?|loses? (?:its )?peg|sec (?:sues|charges)|(?:bitcoin|ether(?:eum)?|crypto|spot) etfs? (?:approv\\w*|reject\\w*|den(?:y|ied))|(?:approves?|approved|rejects?|rejected|denies|denied) (?:spot )?(?:bitcoin|ether(?:eum)?) etfs?",
    ),
    category: "crypto",
    impact: "HIGH",
    why: "Hacks, collapses, depegs and ETF decisions move the whole crypto market, often within minutes.",
  },
  {
    tag: "crypto",
    re: W(
      "bitcoin|btc|ether(?:eum)?|crypto(?:currenc(?:y|ies))?|stablecoins?|tether|usdt|usdc|binance|coinbase|kraken|solana|xrp|ripple|defi|blockchain|spot etf|microstrategy|strategy inc",
    ),
    category: "crypto",
    impact: "LOW",
    why: "Crypto-specific news.",
  },
  // World
  {
    tag: "war",
    re: W(
      "(?<!trade |price |bidding |culture |currency |talent |console |star )wars?|invasion|invades?|invaded|missiles? (?:strikes?|attacks?|launch\\w*|fired|hits?)|(?:fires?|fired|launch(?:es|ed)?) (?:\\w+ )?(?:ballistic )?missiles?|airstrikes?|air strikes?|bombing|bombard\\w*|shelling|troops (?:enter|cross|mass)|military (?:strike|attack|operation|escalation)|declares? war|nuclear (?:strike|attack|test|threat)|drone (?:strike|attack)s?|naval blockade|martial law",
    ),
    category: "world",
    impact: "HIGH",
    why: "War and military escalation push investors out of risky assets: crypto and stocks often fall while gold, oil and the dollar rise.",
  },
  {
    tag: "pandemic",
    re: W(
      "declares? (?:a )?(?:global )?pandemic|pandemic (?:declared|alert)|epidemic|(?:virus|covid(?:-19)?|coronavirus|flu|disease|ebola|mpox) (?:outbreak|spreads?|spreading|surges?|cases|deaths)|outbreak|new (?:covid |coronavirus )?variant|lockdowns?|bird flu|h5n1|public health emergency",
    ),
    category: "world",
    impact: "HIGH",
    why: "Pandemics shut economies down; in March 2020 COVID news sent Bitcoin down about 50% in two days.",
  },
  {
    tag: "terror",
    re: W("terror(?:ist)? attacks?|assassinat\\w*|coup|state of emergency"),
    category: "world",
    impact: "HIGH",
    why: "Sudden security shocks cause fast risk-off moves until the situation is clear.",
  },
  {
    tag: "financial-crisis",
    re: W(
      "bank (?:run|collapse|failure)s?|banks? collapses?|(?:sovereign|debt) default|defaults? on (?:its )?debt|bailout|contagion|circuit breakers?|trading halted|market crash|flash crash|credit rating downgrade|downgrades? (?:us|u\\.s\\.|united states) (?:credit|rating)",
    ),
    category: "world",
    impact: "HIGH",
    why: "Financial stress spreads across markets quickly; leverage gets cut everywhere, crypto included.",
  },
  {
    tag: "trade-sanctions",
    re: W(
      "tariffs?|trade war|sanctions?|export (?:ban|controls?)|embargo|government shutdown|debt ceiling",
    ),
    category: "world",
    impact: "MEDIUM",
    why: "Tariffs and sanctions change growth and inflation expectations; big announcements move risk assets.",
  },
  {
    tag: "geopolitics",
    re: W(
      "ceasefire|peace (?:talks|deal)|military|troops|conflict|hostilities|nato|taiwan strait|north korea|iran|israel|gaza|ukraine|russia|hamas|hezbollah|houthis?|opec\\+?|oil supply|strait of hormuz|elections?|impeach\\w*|earthquake|tsunami|hurricane|typhoon",
    ),
    category: "world",
    impact: "MEDIUM",
    why: "Geopolitical events can move oil, gold and risk appetite.",
  },
  // Economy
  {
    tag: "data-shock",
    re: W(
      "(?:inflation|cpi|pce|payrolls|jobs report|nfp|gdp) (?:surges?|jumps?|soars?|plunges?|slumps?|tumbles?|unexpectedly|hotter|cooler)|(?:hotter|cooler|stronger|weaker)[- ]than[- ]expected|enters? recession|falls? into recession",
    ),
    category: "economy",
    impact: "HIGH",
    why: "Big economic surprises change the interest-rate outlook, which moves crypto and gold.",
  },
  {
    tag: "data",
    re: W(
      "inflation|cpi|ppi|pce|consumer prices|nonfarm|non-farm|payrolls|jobs report|unemployment|jobless claims|gdp|retail sales|pmi|consumer confidence|housing starts|industrial production|recession|stagflation",
    ),
    category: "economy",
    impact: "MEDIUM",
    why: "Economic data feeds into interest-rate expectations.",
  },
];

/** Phrases that look like big news but are not (a "price war" is not a war). */
const NOT_NEWS = W(
  "price war|bidding war|war of words|culture war|talent war|console war|star wars|war chest|warcraft|warhammer|heart attack|panic attack|computer virus|virus scan|outbreak of (?:optimism|buying|selling)",
);

const CATEGORY_RANK: Record<NewsCategory, number> = {
  "central-banks": 5,
  crypto: 4,
  world: 3,
  economy: 2,
  markets: 1,
};
const IMPACT_RANK: Record<NewsImpact, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export interface Classification {
  category: NewsCategory;
  impact: NewsImpact;
  tags: string[];
  why: string | null;
}

/**
 * Folder, impact, tags and a "why it matters" line for one headline. Official central-bank
 * releases always go to Central banks; a Fed monetary-policy release is always High. A provider's
 * own importance (Trading Economics 0–3) can raise but never lower the rating.
 */
export function classifyHeadline(input: {
  title: string;
  summary?: string | null;
  source?: NewsSource;
  /** The source's own section ("crypto", "forex", …), if any. */
  sourceCategory?: string | null;
  /** Provider importance 0–3, if any. */
  importance?: number | null;
  /** An official monetary-policy release (FOMC statement, ECB decision). */
  monetaryPolicy?: boolean;
}): Classification {
  // The title decides; the summary only adds context for folders, never for impact.
  const title = input.title.replace(NOT_NEWS, " ");
  const summary = (input.summary ?? "").replace(NOT_NEWS, " ");
  const test = (r: Rule, text: string) =>
    (Array.isArray(r.re) ? r.re : [r.re]).some((re) => re.test(text));
  const hits = NEWS_RULES.filter((r) => test(r, title));
  const contextHits = NEWS_RULES.filter((r) => !hits.includes(r) && test(r, summary));

  const effective = (r: Rule): NewsImpact =>
    r.impact === "HIGH" && r.highOnlyWith && !r.highOnlyWith.test(title) ? "MEDIUM" : r.impact;
  let impact: NewsImpact = "LOW";
  for (const r of hits) if (IMPACT_RANK[effective(r)] > IMPACT_RANK[impact]) impact = effective(r);
  if (input.importance !== undefined && input.importance !== null) {
    const p: NewsImpact = input.importance >= 3 ? "HIGH" : input.importance >= 2 ? "MEDIUM" : "LOW";
    if (IMPACT_RANK[p] > IMPACT_RANK[impact]) impact = p;
  }
  if (input.monetaryPolicy) impact = "HIGH";

  const pool = hits.length > 0 ? hits : contextHits;
  let category: NewsCategory = "markets";
  let lead: Rule | undefined;
  for (const r of pool) {
    const better =
      !lead ||
      IMPACT_RANK[r.impact] > IMPACT_RANK[lead.impact] ||
      (IMPACT_RANK[r.impact] === IMPACT_RANK[lead.impact] &&
        CATEGORY_RANK[r.category] > CATEGORY_RANK[lead.category]);
    if (better) lead = r;
  }
  if (lead) category = lead.category;
  // A crypto section or a crypto headline stays in Crypto unless something bigger is going on.
  const sc = (input.sourceCategory ?? "").toLowerCase();
  if (sc === "crypto" && (category === "markets" || !hits.some((r) => effective(r) === "HIGH")))
    category = "crypto";
  if (input.source === "FED" || input.source === "ECB") category = "central-banks";

  // An official policy release explains itself as a policy decision, whatever its title says.
  const policy = input.monetaryPolicy
    ? NEWS_RULES.find((r) => r.tag === "rate-decision")
    : undefined;
  const leadHigh = hits.find((r) => effective(r) === impact) ?? policy ?? lead;
  return {
    category,
    impact,
    tags: [...new Set(hits.map((r) => r.tag))],
    why: impact === "LOW" ? null : (leadHigh?.why ?? null),
  };
}

// ─── Same story, several sources ───

const STOP = new Set(
  "a an the and or of to in on for at by with from as is are was were be been its it this that after over says said amid into new live update updates breaking".split(
    " ",
  ),
);

/** The meaningful words of a headline, for spotting the same story from different sources. */
export function headlineWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[’']s\b/g, "")
      .replace(/[^a-z0-9%.$ ]+/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/\.$/, ""))
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

/** Share of words two headlines have in common (Jaccard), 0..1. */
export function headlineSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / (a.size + b.size - common);
}

export const SAME_STORY = 0.5;

// ─── Market reaction ───

/** % move from the open of the publication minute to the close of the minute `after` later. */
export function priceReaction(
  candles: ReadonlyArray<{ t: number; o: number; c: number }>,
  publishedAt: number,
  afterMs: number,
): number | null {
  const startMinute = Math.floor(publishedAt / 60_000) * 60_000;
  const endMinute = Math.floor((publishedAt + afterMs) / 60_000) * 60_000;
  const start = candles.find((c) => c.t === startMinute);
  const end = candles.find((c) => c.t === endMinute);
  if (!start || !end || !(start.o > 0)) return null;
  return (end.c / start.o - 1) * 100;
}
