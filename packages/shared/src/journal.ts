import { z } from "zod";
import type { TradeContextDto, TradeReviewDto } from "./coach.js";
import type { PositionDto } from "./positions.js";

/**
 * Journal vocabulary. Fixed lists (rather than free text) make emotions and mistakes countable, so
 * the dashboard and the AI coach can say which ones cost the most. Stored as these codes.
 */
export const EMOTIONS = {
  CALM: "Calm",
  CONFIDENT: "Confident",
  FOMO: "FOMO",
  REVENGE: "Revenge",
  FEAR: "Fear",
  GREED: "Greed",
  OVERCONFIDENT: "Overconfident",
  IMPATIENT: "Impatient",
  BORED: "Bored",
  FRUSTRATED: "Frustrated",
} as const;
export type EmotionCode = keyof typeof EMOTIONS;
export const EMOTION_CODES = Object.keys(EMOTIONS) as EmotionCode[];

export const MISTAKES = {
  NO_PLAN: "No plan before entry",
  CHASED_ENTRY: "Chased the entry",
  NO_STOP: "No stop loss",
  MOVED_STOP: "Moved the stop",
  HELD_LOSER: "Held a loser too long",
  CUT_WINNER_EARLY: "Took profit too early",
  OVERSIZED: "Position too large",
  OVERTRADING: "Overtrading",
  AGAINST_TREND: "Traded against the trend",
  BROKE_RULES: "Broke my rules",
} as const;
export type MistakeCode = keyof typeof MISTAKES;
export const MISTAKE_CODES = Object.keys(MISTAKES) as MistakeCode[];

export const MAX_TAGS = 10;
export const MAX_SCREENSHOTS = 4;
export const MAX_NOTES = 10_000;

const decimalString = z
  .string()
  .trim()
  .regex(/^\d{1,18}(\.\d{1,18})?$/, "Enter a positive number")
  .refine((v) => Number(v) > 0, "Enter a positive number");

const tag = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[\p{L}\p{N} _\-/#&+.]+$/u, "Letters, numbers, spaces and - _ / # & + . only");

/** Full replacement of a trade's journal entry (PUT semantics); empty fields clear values. */
export const journalInputSchema = z
  .object({
    setup: z.string().trim().max(80).nullable().default(null),
    tags: z
      .array(tag)
      .max(MAX_TAGS)
      .default([])
      // Case-insensitive de-duplication keeps "Breakout" and "breakout" as one tag.
      .transform((tags) => [...new Map(tags.map((t) => [t.toLowerCase(), t])).values()]),
    emotions: z
      .array(z.enum(EMOTION_CODES as [EmotionCode, ...EmotionCode[]]))
      .max(EMOTION_CODES.length)
      .default([])
      .transform((v) => [...new Set(v)]),
    mistakes: z
      .array(z.enum(MISTAKE_CODES as [MistakeCode, ...MistakeCode[]]))
      .max(MISTAKE_CODES.length)
      .default([])
      .transform((v) => [...new Set(v)]),
    rating: z.number().int().min(1).max(5).nullable().default(null),
    notes: z.string().max(MAX_NOTES).nullable().default(null),
    stopPrice: decimalString.nullable().default(null),
    targetPrice: decimalString.nullable().default(null),
    screenshotUrls: z
      .array(
        z.url({ protocol: /^https$/, hostname: z.regexes.domain }).max(500, "Link is too long"),
      )
      .max(MAX_SCREENSHOTS)
      .default([]),
  })
  .strict();
export type JournalInput = z.input<typeof journalInputSchema>;
export type JournalData = z.output<typeof journalInputSchema>;

export interface JournalDto {
  setup: string | null;
  tags: string[];
  emotions: EmotionCode[];
  mistakes: MistakeCode[];
  rating: number | null;
  notes: string | null;
  stopPrice: string | null;
  targetPrice: string | null;
  screenshotUrls: string[];
  updatedAt: string;
}

/** Derived from the journal's stop and target; null when not measurable. */
export interface RiskDto {
  /** Money at risk between entry and stop. */
  riskAmount: string | null;
  /** Net result divided by the risk: +2 means twice what was risked. */
  rMultiple: number | null;
  /** Planned reward-to-risk from entry, stop and target. */
  plannedRewardRisk: number | null;
}

export interface FillDto {
  id: string;
  side: "BUY" | "SELL";
  role: "OPEN" | "CLOSE";
  price: string;
  qty: string;
  fee: string;
  executedAt: string;
}

export interface TradeDetailDto {
  trade: PositionDto;
  journal: JournalDto | null;
  risk: RiskDto;
  /** Individual executions (Binance, where we rebuild trades from fills); empty otherwise. */
  fills: FillDto[];
  /** The user's previous setups, most used first, for the setup field's suggestions. */
  setupSuggestions: string[];
  /** Grade, behaviour flags and AI review; null for open trades. */
  review: TradeReviewDto | null;
  /** Market context from candles (indicators, structure, zones, excursion). */
  context: TradeContextDto | null;
  /** NONE = not analysed yet; UNAVAILABLE = not enough market history. */
  contextStatus: "DONE" | "UNAVAILABLE" | "NONE";
}
