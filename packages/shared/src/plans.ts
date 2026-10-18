import { z } from "zod";

/** -1 means unlimited. */
export const UNLIMITED = -1;

/**
 * Limits as stored (JSON on the plans table, so admins can tune them without a deploy). Fields
 * added later are optional here: a plan saved before they existed falls back to PLAN_DEFAULTS.
 */
export const planLimitsSchema = z.object({
  exchangeAccounts: z.number().int().min(-1),
  aiReviewsPerMonth: z.number().int().min(-1),
  historyDays: z.number().int().min(-1),
  coachMessagesPerDay: z.number().int().min(-1),
  /** Most the plan may spend on AI per user per calendar month (US$). Protects the margin. */
  aiBudgetUsd: z.number().min(-1).optional(),
  /** MetaTrader (Exness) connections; each one costs a cloud terminal at MetaApi. */
  brokerAccounts: z.number().int().min(-1).optional(),
  /** Saved setups watched by My Setup Alerts. */
  setups: z.number().int().min(-1).optional(),
  /** Alert emails (in-app alerts are on for every plan). 0 = off, 1 = on. */
  setupAlertEmail: z.number().int().min(0).max(1).optional(),
  /** What-If Lab: 0 = locked preview, 1 = full. */
  whatIf: z.number().int().min(0).max(1).optional(),
  /** Strategy Lab backtests per calendar month (UTC). */
  backtestRunsPerMonth: z.number().int().min(-1).optional(),
  /** How far back a backtest may reach, in months. */
  backtestHistoryMonths: z.number().int().min(-1).optional(),
  /** Market Pulse: coins shown (-1 = all) and whether the 7d/30d windows are open. */
  marketPulseCoins: z.number().int().min(-1).optional(),
  marketPulseAllWindows: z.number().int().min(0).max(1).optional(),
  /** Estimated liquidation map: 0 = Bitcoin only (preview), 1 = every supported market. */
  liquidationMap: z.number().int().min(0).max(1).optional(),
  /** Market Context Desk: 0 = Bitcoin only, 1 = every desk market. */
  marketDesk: z.number().int().min(0).max(1).optional(),
});
export type StoredPlanLimits = z.infer<typeof planLimitsSchema>;
export type PlanLimits = Required<StoredPlanLimits>;

export type PlanCodeId = "FREE" | "PRO" | "PREMIUM" | "ENTERPRISE";

/**
 * Monthly list prices (US$). The live price shown at checkout comes from Paddle; this is the
 * fallback for the public pricing section and the seed. Admins can change it in Costs & margins.
 */
export const LIST_PRICE_USD: Record<Exclude<PlanCodeId, "ENTERPRISE">, number> = {
  FREE: 0,
  PRO: 15,
  PREMIUM: 25,
};

type PaidPlan = "PRO" | "PREMIUM";
type BillingInterval = "month" | "year";

/** Yearly list prices: two months free (12 months for the price of 10). */
export const LIST_PRICE_YEARLY_USD: Record<Exclude<PlanCodeId, "ENTERPRISE">, number> = {
  FREE: 0,
  PRO: 150,
  PREMIUM: 250,
};
export const YEARLY_MONTHS_FREE = 2;

/** Percentage saved by paying yearly instead of monthly (17 for two months free). */
export function yearlySavingPct(monthly: number, yearly: number): number {
  return monthly > 0 ? Math.round((1 - yearly / (monthly * 12)) * 100) : 0;
}

/** Crypto has no auto-renewal: each payment buys this many days. */
export const CRYPTO_PERIOD_DAYS: Record<BillingInterval, number> = { month: 30, year: 365 };
export const cryptoPriceUsd = (plan: PaidPlan, interval: BillingInterval): number =>
  interval === "year" ? LIST_PRICE_YEARLY_USD[plan] : LIST_PRICE_USD[plan];

/**
 * New crypto paid-until after buying `interval` of `plan`. Time left on the same plan is kept and
 * extended; time left on another paid plan is converted at its value (e.g. 10 days of Pro at $15
 * become 6 days of Premium at $25), so nothing paid is lost on an upgrade or a downgrade.
 */
export function nextCryptoPaidUntil(input: {
  now: Date;
  currentPlan: string;
  currentUntil: Date | null;
  plan: PaidPlan;
  interval: BillingInterval;
}): Date {
  const { now, currentPlan, currentUntil, plan, interval } = input;
  let start = now.getTime();
  if (
    currentUntil &&
    currentUntil.getTime() > start &&
    (currentPlan === "PRO" || currentPlan === "PREMIUM")
  ) {
    const left = currentUntil.getTime() - start;
    start +=
      currentPlan === plan
        ? left
        : Math.floor((left * LIST_PRICE_USD[currentPlan]) / LIST_PRICE_USD[plan]);
  }
  return new Date(start + CRYPTO_PERIOD_DAYS[interval] * 86_400_000);
}

/**
 * Each plan's monthly AI budget stays well under a quarter of its price, the main cost that grows
 * with each user. Exness is counted separately from crypto exchanges because each account runs a
 * paid MetaApi cloud terminal (~US$8/month): Pro includes one, Premium two.
 */
type OptionalLimit = Exclude<keyof PlanLimits, RequiredLimit>;
type RequiredLimit =
  | "exchangeAccounts"
  | "aiReviewsPerMonth"
  | "historyDays"
  | "coachMessagesPerDay";

export const PLAN_DEFAULTS: Record<PlanCodeId, Pick<PlanLimits, OptionalLimit>> = {
  FREE: {
    aiBudgetUsd: 0.3,
    brokerAccounts: 0,
    setups: 1,
    setupAlertEmail: 0,
    whatIf: 0,
    backtestRunsPerMonth: 0,
    backtestHistoryMonths: 0,
    marketPulseCoins: 20,
    marketPulseAllWindows: 0,
    liquidationMap: 0,
    marketDesk: 0,
  },
  PRO: {
    aiBudgetUsd: 3,
    brokerAccounts: 1,
    setups: 5,
    setupAlertEmail: 1,
    whatIf: 1,
    backtestRunsPerMonth: 0,
    backtestHistoryMonths: 0,
    marketPulseCoins: UNLIMITED,
    marketPulseAllWindows: 1,
    liquidationMap: 1,
    marketDesk: 1,
  },
  PREMIUM: {
    aiBudgetUsd: 7,
    brokerAccounts: 2,
    setups: 20,
    setupAlertEmail: 1,
    whatIf: 1,
    backtestRunsPerMonth: 30,
    backtestHistoryMonths: 24,
    marketPulseCoins: UNLIMITED,
    marketPulseAllWindows: 1,
    liquidationMap: 1,
    marketDesk: 1,
  },
  ENTERPRISE: {
    aiBudgetUsd: UNLIMITED,
    brokerAccounts: UNLIMITED,
    setups: UNLIMITED,
    setupAlertEmail: 1,
    whatIf: 1,
    backtestRunsPerMonth: UNLIMITED,
    backtestHistoryMonths: 24,
    marketPulseCoins: UNLIMITED,
    marketPulseAllWindows: 1,
    liquidationMap: 1,
    marketDesk: 1,
  },
};

const OPTIONAL_LIMITS = Object.keys(PLAN_DEFAULTS.FREE) as OptionalLimit[];

/** Stored limits with every field filled in (missing new fields come from PLAN_DEFAULTS). */
export function resolveLimits(code: PlanCodeId, raw: unknown): PlanLimits {
  const parsed = planLimitsSchema.safeParse(raw);
  const d = PLAN_DEFAULTS[code] ?? PLAN_DEFAULTS.FREE;
  if (!parsed.success) {
    // Unreadable limits must fail closed, never open.
    return {
      exchangeAccounts: 1,
      aiReviewsPerMonth: 0,
      historyDays: 30,
      coachMessagesPerDay: 0,
      ...PLAN_DEFAULTS.FREE,
      aiBudgetUsd: 0,
      brokerAccounts: 0,
      setups: 0,
      whatIf: 0,
      backtestRunsPerMonth: 0,
    };
  }
  const filled = { ...parsed.data } as PlanLimits;
  for (const k of OPTIONAL_LIMITS) {
    if (parsed.data[k] === undefined) (filled[k] as number) = d[k];
  }
  return filled;
}
