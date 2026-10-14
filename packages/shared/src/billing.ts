import { z } from "zod";
import type { PlanLimits } from "./plans.js";

export type PaidPlan = "PRO" | "PREMIUM";
export type BillingInterval = "month" | "year";

export interface PlanOfferDto {
  code: "FREE" | "PRO" | "PREMIUM" | "ENTERPRISE";
  name: string;
  limits: PlanLimits;
  /** Paddle price IDs for checkout; empty when the plan is not sold online. */
  prices: { interval: BillingInterval; priceId: string }[];
}

export interface BillingDto {
  /** Plan whose limits apply now (Free when a paid subscription has lapsed). */
  plan: { code: PlanOfferDto["code"]; name: string };
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "PAUSED" | "CANCELED";
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** True when a Paddle customer exists, so the billing portal can be opened. */
  hasBillingAccount: boolean;
  /** A live subscription billed through Paddle: plan changes go through it, not a new checkout. */
  hasOnlineSubscription: boolean;
  /** Paddle price of the live subscription. */
  currentPriceId: string | null;
  /** Plan granted by support (not billed online). */
  manualPlan: boolean;
  offers: PlanOfferDto[];
  /** Online checkout is configured. */
  checkoutEnabled: boolean;
  email: string;
  userId: string;
}

export const changePlanSchema = z
  .object({ priceId: z.string().regex(/^pri_[a-z0-9]{6,64}$/i, "Unknown price") })
  .strict();

// ─── Admin ───

export interface AdminOverviewDto {
  users: { total: number; new7d: number; new30d: number; suspended: number };
  subscriptions: { plan: string; status: string; count: number }[];
  exchanges: { exchange: string; status: string; count: number }[];
  sync: { runs24h: number; failed24h: number; failingAccounts: number };
  trades: { total: number; last24h: number };
  ai: {
    reviewsThisMonth: number;
    notesThisMonth: number;
    messagesThisMonth: number;
    tokensThisMonth: number;
  };
  signups: { date: string; count: number }[];
}

export interface AdminUserRowDto {
  id: string;
  email: string;
  name: string | null;
  role: "USER" | "ADMIN";
  plan: string;
  status: string;
  manualPlan: boolean;
  exchanges: number;
  createdAt: string;
  suspended: boolean;
  foundingMember: boolean;
}

export interface AdminUsersPage {
  items: AdminUserRowDto[];
  nextCursor: string | null;
}

export interface AdminUserDetailDto extends AdminUserRowDto {
  timezone: string;
  currentPeriodEnd: string | null;
  paddleSubscriptionId: string | null;
  accounts: {
    id: string;
    exchange: string;
    label: string;
    status: string;
    lastSyncedAt: string | null;
    lastError: string | null;
    syncFailures: number;
  }[];
  usage: { metric: string; period: string; count: number }[];
  trades: number;
  recentAudit: AdminAuditRowDto[];
}

export interface AdminAuditRowDto {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorEmail: string | null;
  ip: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface AdminSyncRowDto {
  id: string;
  accountId: string;
  exchange: string;
  userEmail: string;
  kind: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AdminLogsPage<T> {
  items: T[];
  nextCursor: string | null;
}

export const adminPlanChangeSchema = z
  .object({
    planCode: z.enum(["FREE", "PRO", "PREMIUM", "ENTERPRISE"]),
    /** Recorded in the audit log. */
    reason: z.string().trim().min(3, "Give a short reason").max(300),
  })
  .strict();
export type AdminPlanChange = z.infer<typeof adminPlanChangeSchema>;

export const adminSuspendSchema = z
  .object({ suspended: z.boolean(), reason: z.string().trim().min(3).max(300) })
  .strict();

export const announcementInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(1000),
    level: z.enum(["INFO", "WARNING"]).default("INFO"),
    startsAt: z.iso.datetime({ offset: true }).optional(),
    endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .refine((a) => !a.endsAt || !a.startsAt || a.endsAt > a.startsAt, {
    message: "The end must be after the start",
    path: ["endsAt"],
  });
export type AnnouncementInput = z.infer<typeof announcementInputSchema>;

export interface AnnouncementDto {
  id: string;
  title: string;
  body: string;
  level: "INFO" | "WARNING";
  startsAt: string;
  endsAt: string | null;
}

// ─── Admin: costs and margins ───

export interface AdminPlanCostRow {
  code: "FREE" | "PRO" | "PREMIUM" | "ENTERPRISE";
  name: string;
  /** Monthly list price (US$); null until an admin sets it. */
  priceUsd: number | null;
  limits: PlanLimits;
  users: number;
  revenueUsd: number;
  aiCostUsd: number;
  brokerAccounts: number;
  metaapiCostUsd: number;
  paymentFeesUsd: number;
  /** (revenue − AI − MetaApi − payment fees) ÷ revenue; null without revenue. */
  marginPct: number | null;
}

export interface AdminUserCostRow {
  id: string;
  email: string;
  plan: AdminPlanCostRow["code"];
  foundingMember: boolean;
  aiCostUsd: number;
  aiBudgetUsd: number;
  /** Share of the monthly AI budget used; null when unlimited. */
  budgetUsedPct: number | null;
  brokerAccounts: number;
  marginPct: number | null;
}

export interface AdminCostsDto {
  month: string;
  assumptions: { metaapiUsdPerAccount: number; paymentPct: number; paymentFixedUsd: number };
  plans: AdminPlanCostRow[];
  totals: {
    users: number;
    revenueUsd: number;
    aiCostUsd: number;
    metaapiCostUsd: number;
    paymentFeesUsd: number;
    grossProfitUsd: number;
    marginPct: number | null;
  };
  /** Most expensive users this month (AI first). */
  topUsers: AdminUserCostRow[];
  /** The margin target the page checks against. */
  targetMarginPct: number;
}

const limitInt = z.number().int().min(-1).max(1_000_000);
export const adminPlanUpdateSchema = z
  .object({
    priceUsd: z.number().min(0).max(10_000).nullable(),
    exchangeAccounts: limitInt,
    aiReviewsPerMonth: limitInt,
    historyDays: limitInt,
    coachMessagesPerDay: limitInt,
    aiBudgetUsd: z.number().min(-1).max(10_000),
    brokerAccounts: limitInt,
    setups: limitInt,
    setupAlertEmail: z.number().int().min(0).max(1),
    whatIf: z.number().int().min(0).max(1),
    backtestRunsPerMonth: limitInt,
    backtestHistoryMonths: limitInt,
    marketPulseCoins: limitInt,
    marketPulseAllWindows: z.number().int().min(0).max(1),
  })
  .strict();
export type AdminPlanUpdate = z.infer<typeof adminPlanUpdateSchema>;

export const adminFoundingSchema = z.object({ foundingMember: z.boolean() }).strict();
