import { z } from "zod";

// ─── Risk limits ───

const money = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount, e.g. 250 or 250.50")
  .refine((v) => Number(v) > 0, "Must be more than 0");

/** Daily guard-rails. Empty = no limit. Amounts are in USD. */
export const riskLimitsSchema = z
  .object({
    maxDailyLoss: money.nullable().default(null),
    maxTradesPerDay: z.number().int().min(1).max(500).nullable().default(null),
    /** Largest allowed fall from your equity peak (closed P&L). */
    maxDrawdown: money.nullable().default(null),
    dailyProfitTarget: money.nullable().default(null),
  })
  .strict();
export type RiskLimitsInput = z.input<typeof riskLimitsSchema>;
export type RiskLimits = z.output<typeof riskLimitsSchema>;

export const RISK_RULES = {
  MAX_DAILY_LOSS: "Maximum daily loss",
  MAX_TRADES_PER_DAY: "Maximum trades per day",
  MAX_DRAWDOWN: "Maximum drawdown",
  DAILY_PROFIT_TARGET: "Daily profit target",
} as const;
export type RiskRule = keyof typeof RISK_RULES;

export interface RiskRuleStatusDto {
  rule: RiskRule;
  label: string;
  limit: string;
  value: string;
  /** Share of the limit used (or of the target reached), 0-1+. */
  used: number;
  /** NEAR = 80% of a limit used; HIT = a profit target reached. */
  state: "OK" | "NEAR" | "BREACHED" | "HIT";
  message: string;
}

export interface RiskStatusDto {
  date: string;
  limits: RiskLimits;
  rules: RiskRuleStatusDto[];
}

// ─── Goals ───

export const GOAL_METRICS = {
  NET_PNL: { label: "Net profit", unit: "USD", better: "HIGHER" },
  WIN_RATE: { label: "Win rate", unit: "%", better: "HIGHER" },
  PROFIT_FACTOR: { label: "Profit factor", unit: "", better: "HIGHER" },
  MAX_TRADES: { label: "Trades (at most)", unit: "trades", better: "LOWER" },
  REVIEW_RATE: { label: "Trades reviewed", unit: "%", better: "HIGHER" },
} as const;
export type GoalMetric = keyof typeof GOAL_METRICS;
export const GOAL_METRIC_CODES = Object.keys(GOAL_METRICS) as GoalMetric[];
export type GoalPeriod = "WEEK" | "MONTH";

export const goalInputSchema = z
  .object({
    period: z.enum(["WEEK", "MONTH"]),
    metric: z.enum(GOAL_METRIC_CODES as [GoalMetric, ...GoalMetric[]]),
    target: z
      .string()
      .trim()
      .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter a number")
      .refine((v) => Number(v) > 0, "Must be more than 0"),
  })
  .strict()
  .superRefine((g, ctx) => {
    const n = Number(g.target);
    if ((g.metric === "WIN_RATE" || g.metric === "REVIEW_RATE") && n > 100)
      ctx.addIssue({ code: "custom", path: ["target"], message: "A percentage is at most 100" });
    if (g.metric === "MAX_TRADES" && !Number.isInteger(n))
      ctx.addIssue({ code: "custom", path: ["target"], message: "Use a whole number of trades" });
  });
export type GoalInput = z.infer<typeof goalInputSchema>;

export const MAX_GOALS = 12;

export interface GoalDto {
  id: string;
  period: GoalPeriod;
  metric: GoalMetric;
  label: string;
  target: string;
  /** Current period (YYYY-MM-DD start) in the trader's timezone. */
  periodStart: string;
  periodEnd: string;
  value: string;
  /** 0-1 towards the goal (for "at most" goals: share of the allowance used). */
  progress: number;
  state: "ON_TRACK" | "BEHIND" | "MET" | "FAILED";
  message: string;
}

// ─── Notifications ───

export const NOTIFICATION_KINDS = {
  RISK_WARNING: "Risk warnings",
  DAILY_REMINDER: "Daily journal reminder",
  WEEKLY_REPORT: "Weekly report",
  MONTHLY_REPORT: "Monthly report",
  GOAL_UPDATE: "Goal updates",
  COACH_NOTE: "Coaching notes",
  ACCOUNT: "Account and exchange alerts",
  SETUP_ALERT: "My setup alerts",
  SCALP_ALERT: "Scalp Cockpit alerts",
} as const;
export type NotificationKind = keyof typeof NOTIFICATION_KINDS;
export const NOTIFICATION_KIND_CODES = Object.keys(NOTIFICATION_KINDS) as NotificationKind[];

export interface NotificationDto {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationsPage {
  items: NotificationDto[];
  unread: number;
  nextCursor: string | null;
}

/** Email choices per kind (in-app notifications are always on), plus the reminder hour. */
export const notificationPrefsSchema = z
  .object({
    email: z
      .object(
        Object.fromEntries(NOTIFICATION_KIND_CODES.map((k) => [k, z.boolean()])) as Record<
          NotificationKind,
          z.ZodBoolean
        >,
      )
      .partial()
      .default({}),
    /** Local hour (0-23) for the daily journal reminder. */
    reminderHour: z.number().int().min(0).max(23).default(21),
  })
  .strict();
export type NotificationPrefs = z.output<typeof notificationPrefsSchema>;

/** Defaults: safety-relevant and summary emails on, daily nudges off. */
export const DEFAULT_EMAIL_PREFS: Record<NotificationKind, boolean> = {
  RISK_WARNING: true,
  DAILY_REMINDER: false,
  WEEKLY_REPORT: true,
  MONTHLY_REPORT: true,
  GOAL_UPDATE: false,
  COACH_NOTE: false,
  ACCOUNT: true,
  SETUP_ALERT: true,
  SCALP_ALERT: false,
};

export function emailWanted(prefs: unknown, kind: NotificationKind): boolean {
  const parsed = notificationPrefsSchema.safeParse(prefs ?? {});
  const chosen = parsed.success ? parsed.data.email[kind] : undefined;
  return chosen ?? DEFAULT_EMAIL_PREFS[kind];
}

export function reminderHour(prefs: unknown): number {
  const parsed = notificationPrefsSchema.safeParse(prefs ?? {});
  return parsed.success ? parsed.data.reminderHour : 21;
}
