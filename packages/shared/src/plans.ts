import { z } from "zod";

/** -1 means unlimited. Stored as JSON on the plans table so limits can change without a deploy. */
export const planLimitsSchema = z.object({
  exchangeAccounts: z.number().int().min(-1),
  aiReviewsPerMonth: z.number().int().min(-1),
  historyDays: z.number().int().min(-1),
  coachMessagesPerDay: z.number().int().min(-1),
});

export type PlanLimits = z.infer<typeof planLimitsSchema>;

export const UNLIMITED = -1;
