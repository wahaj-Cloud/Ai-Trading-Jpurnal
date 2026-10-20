import {
  classifyStrength,
  type FlowStrength,
  STRENGTH_THRESHOLDS,
  STRENGTHS,
} from "./orderflow.js";
import type { ReadoutRecord } from "./scalp-alerts.js";

/**
 * Threshold review (admin): how buy pressure was actually spread over the recorded minutes, how
 * often each strength label came up with today's thresholds, what thresholds would make "Neutral"
 * about half the time and "Strong" about one minute in ten, and what price did in the 15 minutes
 * after each label. Crypto coins and metals (gold, silver) are reviewed separately.
 */

export const CALIBRATION_WINDOWS = ["5m", "15m", "30m", "1h"] as const;
export type CalibrationWindow = (typeof CALIBRATION_WINDOWS)[number];
const INDEX: Record<CalibrationWindow, number> = { "5m": 6, "15m": 7, "30m": 8, "1h": 9 };
const PRICE = 10;

export interface CalibrationWindowDto {
  window: CalibrationWindow;
  samples: number;
  absPercentiles: { p50: number; p75: number; p90: number; p95: number } | null;
  current: { lean: number; strong: number };
  /** Share of samples with each label under the current thresholds (0–1). */
  shareNow: Record<FlowStrength, number>;
  suggested: { lean: number; strong: number } | null;
  /** Price 15 minutes later, per label (current thresholds). */
  forward15m: Array<{
    strength: FlowStrength;
    samples: number;
    avgPct: number | null;
    upShare: number | null;
  }>;
}

export interface CalibrationGroupDto {
  key: "crypto" | "metals";
  label: string;
  windows: CalibrationWindowDto[];
}

export interface ScalpCalibrationDto {
  from: string | null;
  to: string | null;
  /** Minutes sampled (every 5th recorded minute). */
  minutes: number;
  groups: CalibrationGroupDto[];
}

const METALS = new Set(["XAUUSDT", "XAGUSDT"]);

/** Nearest-rank percentile of sorted values. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i] as number;
}
const half = (v: number) => Math.max(0.5, Math.round(v * 2) / 2);

export function calibrate(
  rows: ReadonlyArray<{ at: number; data: Record<string, ReadoutRecord> }>,
): ScalpCalibrationDto {
  const sorted = [...rows].sort((a, b) => a.at - b.at);
  const byTime = new Map(sorted.map((r) => [r.at, r.data]));
  const groups: CalibrationGroupDto[] = (["crypto", "metals"] as const).map((key) => ({
    key,
    label: key === "crypto" ? "Crypto coins" : "Gold and silver",
    windows: CALIBRATION_WINDOWS.map((w) => {
      const values: number[] = [];
      const fwd = new Map<FlowStrength, { n: number; sum: number; up: number }>();
      for (const r of sorted) {
        const later = byTime.get(r.at + 15 * 60_000);
        for (const [symbol, rec] of Object.entries(r.data)) {
          if (METALS.has(symbol) !== (key === "metals")) continue;
          const p = rec[INDEX[w]];
          if (typeof p !== "number" || !Number.isFinite(p)) continue;
          values.push(p);
          const price = rec[PRICE];
          const next = later?.[symbol]?.[PRICE];
          if (typeof price === "number" && price > 0 && typeof next === "number" && next > 0) {
            const s = classifyStrength(p, w);
            const g = fwd.get(s) ?? { n: 0, sum: 0, up: 0 };
            const change = (next / price - 1) * 100;
            g.n++;
            g.sum += change;
            if (change > 0) g.up++;
            fwd.set(s, g);
          }
        }
      }
      const abs = values.map(Math.abs).sort((a, b) => a - b);
      const shareNow = Object.fromEntries(STRENGTHS.map((s) => [s, 0])) as Record<
        FlowStrength,
        number
      >;
      for (const v of values) shareNow[classifyStrength(v, w)]++;
      for (const s of STRENGTHS) shareNow[s] = values.length ? shareNow[s] / values.length : 0;
      const pct = abs.length
        ? {
            p50: percentile(abs, 50),
            p75: percentile(abs, 75),
            p90: percentile(abs, 90),
            p95: percentile(abs, 95),
          }
        : null;
      const suggestedLean = pct ? half(pct.p50) : 0;
      return {
        window: w,
        samples: values.length,
        absPercentiles: pct,
        current: STRENGTH_THRESHOLDS[w],
        shareNow,
        suggested: pct
          ? { lean: suggestedLean, strong: Math.max(suggestedLean + 0.5, half(pct.p90)) }
          : null,
        forward15m: STRENGTHS.map((s) => {
          const g = fwd.get(s);
          return {
            strength: s,
            samples: g?.n ?? 0,
            avgPct: g?.n ? g.sum / g.n : null,
            upShare: g?.n ? g.up / g.n : null,
          };
        }),
      };
    }),
  }));
  return {
    from: sorted[0] ? new Date(sorted[0].at).toISOString() : null,
    to: sorted.at(-1) ? new Date((sorted.at(-1) as { at: number }).at).toISOString() : null,
    minutes: sorted.length,
    groups,
  };
}
