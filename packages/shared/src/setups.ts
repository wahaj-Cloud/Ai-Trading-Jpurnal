import { z } from "zod";
import { TIMEFRAMES } from "./coach.js";

/**
 * My Setup Alerts: a trader's own setup, saved as data (never code). The builder writes a rule,
 * the API validates it with this schema, and one shared evaluator (packages/ta) reads it for live
 * alerts, previews and Strategy Lab backtests, so all three always agree.
 */

/** Exchanges whose public candles back setups and backtests. */
export const SETUP_EXCHANGES = ["BINANCE"] as const;
export type SetupExchange = (typeof SETUP_EXCHANGES)[number];

export const SETUP_TIMEFRAMES = TIMEFRAMES;
export type SetupTimeframe = (typeof SETUP_TIMEFRAMES)[number];

/**
 * Candles every evaluation looks at; live and backtest use the same. 600 covers two full UTC days
 * on 5m candles (the previous day's high/low from any time of today) and lets a 200 EMA settle
 * (its starting value weighs under 2% after 400 candles).
 */
export const SETUP_WINDOW = 600;
/** Current rule language version. Older saved rules keep working when it grows. */
export const SETUP_RULE_VERSION = 1;

const side = z.enum(["above", "below"]);
const bias = z.enum(["bullish", "bearish"]);
const within = (max: number) => z.number().int().min(1).max(max);

export const SWEEP_TARGETS = {
  swing_low: "the latest swing low",
  swing_high: "the latest swing high",
  asia_low: "the Asian session low",
  asia_high: "the Asian session high",
  prev_day_low: "the previous day's low",
  prev_day_high: "the previous day's high",
} as const;
export type SweepTarget = keyof typeof SWEEP_TARGETS;

export const SETUP_SESSIONS = { asia: "Asia", london: "London", new_york: "New York" } as const;
export type SetupSession = keyof typeof SETUP_SESSIONS;

export const setupConditionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("ema_trend"),
      fast: z.number().int().min(2).max(200),
      slow: z.number().int().min(3).max(200),
      direction: z.enum(["up", "down"]),
    })
    .strict()
    .refine((c) => c.fast < c.slow, { message: "The fast EMA must be shorter than the slow one" }),
  z
    .object({ type: z.literal("price_vs_ema"), period: z.number().int().min(2).max(200), side })
    .strict(),
  z
    .object({
      type: z.literal("rsi"),
      period: z.number().int().min(2).max(50),
      op: side,
      value: z.number().min(1).max(99),
    })
    .strict(),
  z.object({ type: z.literal("price_vs_vwap"), side }).strict(),
  z
    .object({
      type: z.literal("liquidity_sweep"),
      of: z.enum(Object.keys(SWEEP_TARGETS) as [SweepTarget, ...SweepTarget[]]),
      withinCandles: within(20),
    })
    .strict(),
  z
    .object({
      type: z.literal("fvg"),
      bias,
      /** formed: an unfilled gap appeared recently. retest: price trades back into it now. */
      state: z.enum(["formed", "retest"]),
      withinCandles: within(50),
    })
    .strict(),
  z.object({ type: z.literal("order_block"), bias, withinCandles: within(100) }).strict(),
  z
    .object({
      type: z.literal("structure"),
      event: z.enum(["BOS", "CHOCH", "any"]),
      bias,
      withinCandles: within(50),
    })
    .strict(),
  z
    .object({
      type: z.literal("session"),
      in: z
        .array(z.enum(Object.keys(SETUP_SESSIONS) as [SetupSession, ...SetupSession[]]))
        .min(1)
        .max(3),
    })
    .strict(),
  z.object({ type: z.literal("volume_spike"), multiple: z.number().min(1.1).max(10) }).strict(),
  z.object({ type: z.literal("premium_discount"), zone: z.enum(["discount", "premium"]) }).strict(),
  z
    .object({
      type: z.literal("sd_zone"),
      side: z.enum(["demand", "supply"]),
      /** Only a zone price has not come back to since it formed. */
      fresh: z.boolean(),
    })
    .strict(),
]);
export type SetupCondition = z.infer<typeof setupConditionSchema>;
export type SetupConditionType = SetupCondition["type"];

export const setupRuleSchema = z
  .object({
    version: z.literal(SETUP_RULE_VERSION),
    direction: z.enum(["long", "short"]),
    all: z.array(setupConditionSchema).min(1).max(8),
  })
  .strict()
  // Bounded so a rule can never be used to send large payloads through the system.
  .refine((r) => JSON.stringify(r).length <= 16_384, { message: "This setup is too large" });
export type SetupRule = z.infer<typeof setupRuleSchema>;

const symbol = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,20}USDT$/, "Use a USDT futures symbol such as BTCUSDT");

export const setupInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    exchange: z.enum(SETUP_EXCHANGES).default("BINANCE"),
    symbols: z
      .array(symbol)
      .min(1)
      .max(10)
      .transform((s) => [...new Set(s)]),
    timeframe: z.enum(SETUP_TIMEFRAMES),
    rule: setupRuleSchema,
    cooldownMinutes: z.number().int().min(0).max(1440).default(60),
  })
  .strict();
export type SetupInput = z.infer<typeof setupInputSchema>;

export const setupPatchSchema = setupInputSchema.partial().strict();
export type SetupPatch = z.infer<typeof setupPatchSchema>;

export const setupPreviewSchema = z
  .object({
    exchange: z.enum(SETUP_EXCHANGES).default("BINANCE"),
    symbol,
    timeframe: z.enum(SETUP_TIMEFRAMES),
    rule: setupRuleSchema,
  })
  .strict();
export type SetupPreviewInput = z.infer<typeof setupPreviewSchema>;

export interface SetupDto {
  id: string;
  name: string;
  exchange: SetupExchange;
  symbols: string[];
  timeframe: SetupTimeframe;
  rule: SetupRule;
  cooldownMinutes: number;
  isActive: boolean;
  createdAt: string;
  lastAlertAt: string | null;
  alerts30d: number;
}

export interface SetupsListDto {
  items: SetupDto[];
  /** Plan allowance (-1 = unlimited) and whether alert emails are included. */
  limit: number;
  emailAlerts: boolean;
}

export interface SetupAlertDto {
  id: string;
  setupId: string;
  setupName: string;
  symbol: string;
  timeframe: SetupTimeframe;
  direction: "long" | "short";
  candleCloseAt: string;
  /** Plain-language conditions that matched. */
  matched: string[];
  positionId: string | null;
  dismissed: boolean;
  createdAt: string;
}

export interface SetupAlertsPage {
  items: SetupAlertDto[];
  nextCursor: string | null;
}

export const setupAlertsQuerySchema = z
  .object({
    setupId: z.uuid().optional(),
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export type SetupAlertsQuery = z.infer<typeof setupAlertsQuerySchema>;

export interface PreviewCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface SetupPreviewDto {
  symbol: string;
  timeframe: SetupTimeframe;
  candles: PreviewCandle[];
  /** Candle open times (ms) where the setup matched on close. */
  matches: Array<{ t: number; matched: string[] }>;
}

const n = (v: number) => String(v);

/** One condition in plain words: used by the builder, alerts and AI facts. */
export function describeCondition(c: SetupCondition): string {
  switch (c.type) {
    case "ema_trend":
      return `EMA ${n(c.fast)} ${c.direction === "up" ? "above" : "below"} EMA ${n(c.slow)}`;
    case "price_vs_ema":
      return `Price ${c.side} the ${n(c.period)} EMA`;
    case "rsi":
      return `RSI(${n(c.period)}) ${c.op} ${n(c.value)}`;
    case "price_vs_vwap":
      return `Price ${c.side} VWAP`;
    case "liquidity_sweep":
      return `Swept ${SWEEP_TARGETS[c.of]} (last ${n(c.withinCandles)} candles)`;
    case "fvg":
      return c.state === "formed"
        ? `New ${c.bias} fair value gap (last ${n(c.withinCandles)} candles)`
        : `Retest of a ${c.bias} fair value gap`;
    case "order_block":
      return `Tap into a ${c.bias} order block`;
    case "structure":
      return `${c.event === "any" ? "BOS or CHOCH" : c.event} ${c.bias === "bullish" ? "up" : "down"} (last ${n(c.withinCandles)} candles)`;
    case "session":
      return `During ${c.in.map((s) => SETUP_SESSIONS[s]).join(" / ")}`;
    case "volume_spike":
      return `Volume ${n(c.multiple)}× average`;
    case "premium_discount":
      return `Price in the ${c.zone} half of the range`;
    case "sd_zone":
      return `Tap into a ${c.fresh ? "fresh " : ""}${c.side} zone`;
  }
}

/** Default parameters for each condition when added in the builder. */
export const CONDITION_DEFAULTS: Record<SetupConditionType, SetupCondition> = {
  ema_trend: { type: "ema_trend", fast: 20, slow: 50, direction: "up" },
  price_vs_ema: { type: "price_vs_ema", period: 200, side: "above" },
  rsi: { type: "rsi", period: 14, op: "below", value: 30 },
  price_vs_vwap: { type: "price_vs_vwap", side: "above" },
  liquidity_sweep: { type: "liquidity_sweep", of: "asia_low", withinCandles: 5 },
  fvg: { type: "fvg", bias: "bullish", state: "formed", withinCandles: 3 },
  order_block: { type: "order_block", bias: "bullish", withinCandles: 50 },
  structure: { type: "structure", event: "any", bias: "bullish", withinCandles: 10 },
  session: { type: "session", in: ["london"] },
  volume_spike: { type: "volume_spike", multiple: 1.5 },
  premium_discount: { type: "premium_discount", zone: "discount" },
  sd_zone: { type: "sd_zone", side: "demand", fresh: true },
};

export const CONDITION_LABELS: Record<SetupConditionType, string> = {
  ema_trend: "EMA trend",
  price_vs_ema: "Price vs EMA",
  rsi: "RSI",
  price_vs_vwap: "Price vs VWAP",
  liquidity_sweep: "Liquidity sweep",
  fvg: "Fair value gap",
  order_block: "Order block",
  structure: "BOS / CHOCH",
  session: "Session",
  volume_spike: "Volume spike",
  premium_discount: "Premium / discount",
  sd_zone: "Supply / demand zone",
};

/** Every alert carries this line; alerts describe the trader's own rules, never advice. */
export const SETUP_ALERT_DISCLAIMER =
  "Your own rules matched. Educational, not financial advice — check the chart before you act.";
