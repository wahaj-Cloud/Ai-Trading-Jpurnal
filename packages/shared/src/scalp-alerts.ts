import { z } from "zod";
import { COCKPIT_TFS, type CockpitDto, type CockpitFlag, type CockpitTf } from "./cockpit.js";

/**
 * Scalp alerts: "tell me when Gold has 7 of the 5-minute readings one way and no news warning".
 * Checked every minute after the scan; an alert fires when its condition starts holding, then rests
 * for its cooldown. It reports a count of readings, never a call to trade.
 */

export const SCALP_ALERT_DIRECTIONS = ["ANY", "UP", "DOWN"] as const;
export type ScalpAlertDirection = (typeof SCALP_ALERT_DIRECTIONS)[number];
export const SCALP_ALERT_DIRECTION_LABEL: Record<ScalpAlertDirection, string> = {
  ANY: "either way",
  UP: "leaning up",
  DOWN: "leaning down",
};

const symbol = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,20}USDT$/);

export const createScalpAlertSchema = z
  .object({
    symbol,
    tf: z.enum(COCKPIT_TFS),
    direction: z.enum(SCALP_ALERT_DIRECTIONS).default("ANY"),
    /** Readings that must lean the same way (out of up to 10). */
    minCount: z.coerce.number().int().min(3).max(12),
    /** Stay quiet while a news warning is up (release due or just out, fresh headline). */
    noNews: z.coerce.boolean().default(true),
    cooldownMin: z.coerce.number().int().min(5).max(240).default(30),
    /** One-tap trade plan sent with the alert (the trader's own rules). */
    planStopRanges: z.coerce.number().min(0.3).max(10).default(1.5),
    planTargetR: z.coerce.number().min(0.3).max(10).default(2),
    planRiskUsd: z.coerce.number().min(1).max(1_000_000).nullable().default(null),
  })
  .strict();
export type CreateScalpAlert = z.infer<typeof createScalpAlertSchema>;

export const updateScalpAlertSchema = z
  .object({
    enabled: z.boolean().optional(),
    minCount: z.number().int().min(3).max(12).optional(),
    direction: z.enum(SCALP_ALERT_DIRECTIONS).optional(),
    noNews: z.boolean().optional(),
    cooldownMin: z.number().int().min(5).max(240).optional(),
    planStopRanges: z.number().min(0.3).max(10).optional(),
    planTargetR: z.number().min(0.3).max(10).optional(),
    planRiskUsd: z.number().min(1).max(1_000_000).nullable().optional(),
  })
  .strict();
export type UpdateScalpAlert = z.infer<typeof updateScalpAlertSchema>;

export interface ScalpAlertDto {
  id: string;
  symbol: string;
  tf: CockpitTf;
  direction: ScalpAlertDirection;
  minCount: number;
  noNews: boolean;
  cooldownMin: number;
  enabled: boolean;
  lastFiredAt: string | null;
  createdAt: string;
  planStopRanges: number;
  planTargetR: number;
  planRiskUsd: number | null;
}

export interface ScalpAlertsPage {
  items: ScalpAlertDto[];
  /** Alerts this plan allows (-1 = no limit). */
  limit: number;
}

export const SCALP_ALERT_DISCLAIMER =
  "A count of market readings by fixed rules, not a signal to trade. Check the Cockpit, your levels and your risk before acting.";

/** News warnings that keep a "no news" alert quiet. */
export const isNewsFlag = (f: CockpitFlag) => f.key.startsWith("event_") || f.key === "headlines";

/** Whether an alert's condition holds, and which way. */
export function scalpAlertMet(
  alert: Pick<ScalpAlertDto, "direction" | "minCount" | "noNews">,
  readout: Pick<CockpitDto, "tally" | "flags">,
): "up" | "down" | null {
  if (alert.noNews && readout.flags.some(isNewsFlag)) return null;
  const { up, down } = readout.tally;
  if (alert.direction !== "DOWN" && up >= alert.minCount && up > down) return "up";
  if (alert.direction !== "UP" && down >= alert.minCount && down > up) return "down";
  return null;
}

// ─── Readings at entry ───

/** Per-minute record of one market: [up5, down5, total5, up15, down15, total15, p5m, p15m, p30m, p1h, price]. */
export type ReadoutRecord = Array<number | null>;

export interface EntryCount {
  up: number;
  down: number;
  total: number;
}
export interface EntryReadoutDto {
  at: string;
  tf5: EntryCount | null;
  tf15: EntryCount | null;
}
export type StoredEntryReadout = EntryReadoutDto | { none: true };

export const READOUT_KEEP_DAYS = 8;

export function entryFromRecord(at: Date, r: ReadoutRecord): EntryReadoutDto {
  const count = (i: number): EntryCount | null =>
    typeof r[i + 2] === "number" && (r[i + 2] as number) > 0
      ? { up: r[i] as number, down: r[i + 1] as number, total: r[i + 2] as number }
      : null;
  return { at: at.toISOString(), tf5: count(0), tf15: count(3) };
}

export type Alignment = "with" | "against" | "mixed";
export const ALIGNMENT_LABEL: Record<Alignment, string> = {
  with: "With the readings",
  against: "Against the readings",
  mixed: "Readings split",
};
/** A long when more readings leaned up is "with"; when more leaned down, "against". */
export function alignment(direction: "LONG" | "SHORT", c: EntryCount): Alignment {
  if (c.up === c.down) return "mixed";
  const upMore = c.up > c.down;
  return (direction === "LONG") === upMore ? "with" : "against";
}
