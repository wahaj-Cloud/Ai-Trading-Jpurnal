import { z } from "zod";
import type { AnalyticsDto } from "./analytics.js";
import type { BehaviourSummaryDto, CoachNoteDto } from "./coach.js";
import { isoDaySchema } from "./dates.js";
import type { PositionDto } from "./positions.js";

export const REPORT_PERIODS = ["day", "week", "month", "year"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

const isoDay = isoDaySchema;

export const reportQuerySchema = z
  .object({
    period: z.enum(REPORT_PERIODS).default("week"),
    /** Any day inside the period (trader's timezone); defaults to today. */
    date: isoDay.optional(),
  })
  .strict();
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const exportQuerySchema = z
  .object({
    from: isoDay.optional(),
    to: isoDay.optional(),
  })
  .strict()
  .refine((q) => !(q.from && q.to) || q.from <= q.to, {
    message: "`from` must be on or before `to`",
    path: ["from"],
  });
export type ExportQuery = z.infer<typeof exportQuerySchema>;

export interface ReportDto {
  period: ReportPeriod;
  /** First and last day, YYYY-MM-DD in the trader's timezone. */
  from: string;
  to: string;
  label: string;
  previous: string;
  next: string | null;
  analytics: AnalyticsDto;
  behaviour: BehaviourSummaryDto;
  notes: CoachNoteDto[];
  bestTrades: PositionDto[];
  worstTrades: PositionDto[];
}

/** Hard cap on exported rows (one request); larger ranges are exported in parts. */
export const MAX_EXPORT_ROWS = 50_000;
