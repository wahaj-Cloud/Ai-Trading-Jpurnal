import { z } from "zod";

/**
 * Chart settings, saved on this device. Every field is validated on load and falls back to its
 * default, so an old or hand-edited saved value can never break the chart.
 */

export const CHART_TYPES = ["candles", "hollow", "heikin", "bars", "line", "area"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  candles: "Candles",
  hollow: "Hollow candles",
  heikin: "Heikin Ashi",
  bars: "Bars (OHLC)",
  line: "Line",
  area: "Area",
};

/** Where supply and demand zones come from: the chart's timeframe, or a higher one. */
export const SD_SOURCES = ["chart", "15m", "1h", "4h", "1d"] as const;
export type SdSource = (typeof SD_SOURCES)[number];

const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const period = (min: number, max: number, d: number) => z.number().int().min(min).max(max).catch(d);

const maSchema = z.object({
  id: z.string().max(12),
  kind: z.enum(["EMA", "SMA"]).catch("EMA"),
  period: period(2, 500, 20),
  color: color.catch("#f59e0b"),
  on: z.boolean().catch(false),
});
export type MaConfig = z.infer<typeof maSchema>;

const DEFAULT_MAS: MaConfig[] = [
  { id: "ma1", kind: "EMA", period: 20, color: "#f59e0b", on: true },
  { id: "ma2", kind: "EMA", period: 50, color: "#4d94ff", on: true },
  { id: "ma3", kind: "EMA", period: 200, color: "#a855f7", on: false },
  { id: "ma4", kind: "SMA", period: 100, color: "#ec4899", on: false },
];

export const chartSettingsSchema = z.object({
  type: z.enum(CHART_TYPES).catch("candles"),
  upColor: color.catch("#26b07e"),
  downColor: color.catch("#e5484d"),
  grid: z.boolean().catch(true),
  magnet: z.boolean().catch(false),
  logScale: z.boolean().catch(false),
  countdown: z.boolean().catch(true),
  lastPriceLine: z.boolean().catch(true),
  watermark: z.boolean().catch(true),
  timezone: z.enum(["local", "utc"]).catch("local"),
  volume: z.boolean().catch(true),
  mas: z.array(maSchema).length(DEFAULT_MAS.length).catch(DEFAULT_MAS),
  bollinger: z
    .object({
      on: z.boolean().catch(false),
      period: period(2, 200, 20),
      mult: z.number().min(0.5).max(5).catch(2),
    })
    .catch({ on: false, period: 20, mult: 2 }),
  vwap: z.object({ on: z.boolean().catch(false) }).catch({ on: false }),
  rsi: z
    .object({ on: z.boolean().catch(false), period: period(2, 100, 14) })
    .catch({ on: false, period: 14 }),
  macd: z
    .object({
      on: z.boolean().catch(false),
      fast: period(2, 100, 12),
      slow: period(3, 200, 26),
      signal: period(2, 100, 9),
    })
    .catch({ on: false, fast: 12, slow: 26, signal: 9 }),
  /**
   * Unfilled fair value gaps and live order blocks drawn as boxes; supply and demand zones from
   * the chart's own timeframe or a higher one.
   */
  zones: z
    .object({
      fvg: z.boolean().catch(false),
      ob: z.boolean().catch(false),
      sd: z.boolean().catch(true),
      sdTf: z.enum(SD_SOURCES).catch("chart"),
    })
    .catch({ fvg: false, ob: false, sd: true, sdTf: "chart" }),
  /** Estimated liquidation map behind the candles. */
  liqMap: z
    .object({ on: z.boolean().catch(false), window: z.enum(["24h", "7d"]).catch("24h") })
    .catch({ on: false, window: "24h" }),
});
export type ChartSettings = z.infer<typeof chartSettingsSchema>;
export type LiqMapSetting = ChartSettings["liqMap"];

export const DEFAULT_SETTINGS: ChartSettings = chartSettingsSchema.parse({});

const KEY = "wm-chart-settings";

export function loadSettings(): ChartSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? chartSettingsSchema.parse(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: ChartSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: settings last for this visit only
  }
}

/** Ready-made colour pairs, TradingView-style. */
export const COLOR_PRESETS: Array<{ name: string; up: string; down: string }> = [
  { name: "Classic", up: "#26b07e", down: "#e5484d" },
  { name: "TradingView", up: "#089981", down: "#f23645" },
  { name: "Blue / orange", up: "#2962ff", down: "#ff9800" },
  { name: "Mono", up: "#d1d4dc", down: "#5d606b" },
];
