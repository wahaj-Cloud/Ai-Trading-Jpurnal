import { z } from "zod";
import { isoDaySchema } from "./dates.js";

/**
 * Trading behaviours the coach detects. Detection is deterministic (rules over the trader's own
 * numbers and journal); the AI only explains what was found. Each code has a plain-language label and
 * a one-line description shown in the app.
 */
export const BEHAVIOURS = {
  FOMO: { label: "FOMO", about: "Entering late because the move was running away" },
  REVENGE: { label: "Revenge trading", about: "Jumping back in soon after a loss, often bigger" },
  FEAR: { label: "Fear", about: "Cutting good trades short or hesitating" },
  GREED: { label: "Greed", about: "Sizing up far beyond your normal risk" },
  OVERCONFIDENCE: { label: "Overconfidence", about: "Sizing up after a winning streak" },
  IMPATIENCE: { label: "Impatience", about: "Many very short trades that lose" },
  UNDISCIPLINED_ENTRY: {
    label: "Undisciplined entries",
    about: "Entries without a plan or a stop, or chasing price",
  },
  HOLDING_LOSERS: {
    label: "Holding losers",
    about: "Keeping losing trades open far longer than winners",
  },
  EARLY_PROFIT: {
    label: "Early profit taking",
    about: "Winners closed before they could pay for losers",
  },
  OVERTRADING: { label: "Overtrading", about: "Far more trades in a day than your normal" },
  EMOTIONAL: { label: "Emotional trading", about: "Trades you tagged with negative emotions" },
} as const;
export type BehaviourCode = keyof typeof BEHAVIOURS;
export const BEHAVIOUR_CODES = Object.keys(BEHAVIOURS) as BehaviourCode[];

export type Severity = "LOW" | "MEDIUM" | "HIGH";

export interface BehaviourFlagDto {
  code: BehaviourCode;
  severity: Severity;
  /** Plain-language evidence with the trader's own numbers. */
  evidence: string;
  /** Trades involved (journal trade IDs). */
  positionIds: string[];
}

export interface BehaviourSummaryDto {
  /** Period covered (days in the trader's timezone). */
  from: string;
  to: string;
  flags: BehaviourFlagDto[];
  /** Money lost on trades involved in each behaviour (positive = cost). */
  costByBehaviour: { code: BehaviourCode; trades: number; netPnl: string }[];
}

/** Fewest closed trades before a discipline score is shown. */
export const DISCIPLINE_MIN_TRADES = 5;

/**
 * Psychology report: what emotional habits cost (the "psychological tax") and a 0–100 discipline
 * score built from three measured parts. Rules-based and explainable; no AI involved.
 */
export interface PsychologyReportDto {
  from: string;
  to: string;
  /** Closed trades in the period. */
  trades: number;
  /**
   * Net result of every trade flagged with at least one habit (USD-settled, each trade once).
   * Null when those trades did not lose money overall.
   */
  tax: {
    netPnl: string;
    trades: number;
    /** Share (0–1) of all losses in the period that came from flagged trades. */
    lossShare: number | null;
  } | null;
  /** Per-habit net result, worst first. A trade can appear under more than one habit. */
  byHabit: { code: BehaviourCode; trades: number; netPnl: string }[];
  /** 0–100; null below DISCIPLINE_MIN_TRADES. */
  score: number | null;
  /** Each part 0–100; sizing is null when no trade had a measurable USD size. */
  parts: { clean: number; sizing: number | null; calmDays: number } | null;
  /** Last 8 weeks (Monday start), oldest first. */
  trend: { week: string; trades: number; score: number | null }[];
}

export function disciplineLabel(score: number): string {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Mixed";
  return "Needs work";
}

export const GRADES = ["A+", "A", "B", "C", "D", "F"] as const;
export type Grade = (typeof GRADES)[number];

/** NONE: no AI review requested yet (older or imported trades are reviewed on request). */
export type ReviewStatus = "NONE" | "PENDING" | "DONE" | "FAILED" | "LIMIT_REACHED" | "UNAVAILABLE";

export interface TradeReviewDto {
  status: ReviewStatus;
  /** Always present: computed from rules, even without AI. */
  grade: Grade;
  score: number;
  gradeFactors: { label: string; points: number }[];
  flags: BehaviourFlagDto[];
  /** AI-written sections; null until the review is generated. */
  summary: string | null;
  entryAnalysis: string | null;
  exitAnalysis: string | null;
  riskAnalysis: string | null;
  strategyAnalysis: string | null;
  mistakes: string[];
  positives: string[];
  nextTime: string | null;
  /** The journal or trade changed after this review was written. */
  stale: boolean;
  generatedAt: string | null;
  error: string | null;
}

export interface CoachNoteDto {
  id: string;
  kind: "DAILY" | "WEEKLY";
  /** First day of the period, YYYY-MM-DD in the trader's timezone. */
  period: string;
  headline: string;
  wentWell: string[];
  costMoney: string[];
  focus: string;
  flags: BehaviourFlagDto[];
  stats: { trades: number; netPnl: string; winRate: number | null };
  createdAt: string;
}

export interface CoachMessageDto {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
}

export interface ConversationDto {
  id: string;
  title: string;
  updatedAt: string;
  messages: CoachMessageDto[];
}

export interface ConversationSummaryDto {
  id: string;
  title: string;
  updatedAt: string;
}

/** One entry in the journal history: a reviewed trade. */
export interface ReviewedTradeDto {
  positionId: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  closedAt: string;
  netPnl: string;
  settleAsset: string;
  grade: Grade;
  score: number;
  summary: string | null;
  flags: BehaviourCode[];
  updatedAt: string;
}

export interface CoachStatusDto {
  /** False when the AI provider is not configured; rules-based insights still work. */
  aiEnabled: boolean;
  usage: {
    reviewsThisMonth: number;
    reviewsLimit: number;
    messagesToday: number;
    messagesLimit: number;
    /** AI spend this calendar month (US$) and the plan's monthly AI budget (-1 = unlimited). */
    aiSpentUsd: number;
    aiBudgetUsd: number;
  };
}

export const COACH_MESSAGE_MAX = 2_000;

export const chatInputSchema = z
  .object({
    conversationId: z.uuid().optional(),
    message: z.string().trim().min(1, "Type a question").max(COACH_MESSAGE_MAX),
  })
  .strict();
export type ChatInput = z.infer<typeof chatInputSchema>;

export const dailyNoteRequestSchema = z.object({ date: isoDaySchema }).strict();

/** Questions offered as one-tap suggestions in the coach chat. */
export const COACH_SUGGESTIONS = [
  "Why did I lose today?",
  "How can I improve?",
  "Which mistakes am I repeating?",
  "What should I focus on tomorrow?",
  "Compare this week with last week.",
] as const;

/** Starter questions for the coach chat, grouped by what the trader wants to understand. */
export const COACH_QUESTION_GROUPS = [
  {
    id: "today",
    label: "Today & this week",
    questions: [
      "Why did I lose today?",
      "What went well today?",
      "Compare this week with last week.",
      "Summarise my last 7 days in 3 points.",
    ],
  },
  {
    id: "mistakes",
    label: "Mistakes & psychology",
    questions: [
      "Which mistakes am I repeating?",
      "Am I revenge trading after losses?",
      "When do I overtrade, and why?",
      "Do I hold losing trades too long?",
    ],
  },
  {
    id: "risk",
    label: "Risk & money",
    questions: [
      "Why do I lose money even with a good win rate?",
      "Is my position size too big for my account?",
      "What should my maximum daily loss be?",
      "How much are fees costing me?",
    ],
  },
  {
    id: "timing",
    label: "Sessions & coins",
    questions: [
      "Which trading session is best for me?",
      "Which coins should I stop trading?",
      "Which hours of the day lose me money?",
      "Do my longs or my shorts do better?",
    ],
  },
  {
    id: "plan",
    label: "Plan & improve",
    questions: [
      "What should I focus on tomorrow?",
      "Give me 3 rules to follow this week.",
      "Build me a pre-trade checklist from my mistakes.",
      "What is the one change that would help me most?",
    ],
  },
] as const;

/** Queue contract for AI work (the worker processes it). */
export const AI_QUEUE = "ai-coach";
export type AiJobData =
  | { kind: "REVIEW_TRADE"; userId: string; positionId: string; force?: boolean }
  | { kind: "MARKET_CONTEXT"; userId: string; positionId: string; force?: boolean }
  | { kind: "DAILY_NOTE"; userId: string; date: string }
  | { kind: "WEEKLY_NOTE"; userId: string; weekStart: string };

export const aiJobId = (d: AiJobData): string =>
  d.kind === "REVIEW_TRADE"
    ? `review-${d.positionId}`
    : d.kind === "MARKET_CONTEXT"
      ? `context-${d.positionId}`
      : d.kind === "DAILY_NOTE"
        ? `daily-${d.userId}-${d.date}`
        : `weekly-${d.userId}-${d.weekStart}`;

/**
 * Finished jobs are kept for a day: their IDs then block duplicates (e.g. a note the scheduler would
 * otherwise re-queue every tick after a permanent failure). User-forced refreshes use a unique ID.
 */
export const AI_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 86_400 },
} as const;

// ─── Market context (Phase 7) ───

export const TIMEFRAMES = ["5m", "15m", "1h", "4h"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export type ContextCheckCode =
  | "TREND_ALIGNED"
  | "EMA_ALIGNED"
  | "VALUE_ENTRY"
  | "NOT_EXTENDED"
  | "PREMIUM_DISCOUNT"
  | "STRUCTURE_CONFIRMED"
  | "ZONE_CONFLUENCE"
  | "LIQUIDITY_SWEPT"
  | "VOLUME_CONFIRMED"
  | "EXIT_EFFICIENCY"
  | "HELD_GAINS";

export interface ContextCheckDto {
  code: ContextCheckCode;
  label: string;
  /** true = in your favour, false = against, null = not applicable / not measurable. */
  ok: boolean | null;
  detail: string;
  phase: "ENTRY" | "EXIT";
}

export interface ZoneRefDto {
  kind: "FVG" | "ORDER_BLOCK" | "BREAKER" | "MITIGATION";
  direction: "BULLISH" | "BEARISH";
  top: number;
  bottom: number;
}

/** What the market looked like around one trade, computed from candles (no AI). */
export interface TradeContextDto {
  version: number;
  timeframe: Timeframe;
  source: string;
  entry: {
    price: number;
    trend: "UP" | "DOWN" | "RANGE";
    lastStructure: {
      kind: "BOS" | "CHOCH";
      direction: "UP" | "DOWN";
      candlesBefore: number;
    } | null;
    ema20: number | null;
    ema50: number | null;
    ema200: number | null;
    rsi: number | null;
    vwap: number | null;
    atr: number | null;
    volumeRatio: number | null;
    /** (price − EMA20) ÷ ATR: how stretched the entry was. */
    stretchAtr: number | null;
    rangePosition: number | null;
    zone: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM" | null;
    support: number | null;
    resistance: number | null;
    zones: ZoneRefDto[];
    liquiditySwept: { side: "BUY_SIDE" | "SELL_SIDE"; price: number } | null;
  };
  exit: { price: number; trend: "UP" | "DOWN" | "RANGE"; rsi: number | null } | null;
  excursion: {
    /** Best and worst price move while the trade was open, in price units (favourable positive). */
    mfe: number;
    mae: number;
    mfeR: number | null;
    maeR: number | null;
    /** Share of the best available move that was kept at exit (0-1), when the move was favourable. */
    efficiency: number | null;
  } | null;
  checks: ContextCheckDto[];
  /** Share of applicable entry checks that were in the trader's favour, 0-100. */
  entryScore: number | null;
  /** Entry far from value in the trade's direction (chasing). */
  extendedEntry: boolean;
}

/** Aggregate: how trades did when a given check was in or against the trader's favour. */
export interface StrategyInsightDto {
  code: ContextCheckCode;
  label: string;
  withCheck: { trades: number; winRate: number | null; netPnl: string };
  againstCheck: { trades: number; winRate: number | null; netPnl: string };
}
