/**
 * Indicator gauges: the classic technical-ratings method (TradingView's published rules) over
 * 11 oscillators and 15 moving averages, per timeframe, plus a market mood from ADX. Each
 * indicator counts as up, down or neutral by a fixed rule; the gauges show the balance. It
 * describes what the indicators read, never a call to trade.
 */

export const RATING_TFS = ["5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w", "1M"] as const;
export type RatingTf = (typeof RATING_TFS)[number];
export const RATING_TF_LABEL: Record<RatingTf, string> = {
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "2h": "2H",
  "4h": "4H",
  "1d": "1D",
  "1w": "1W",
  "1M": "1M",
};
/** How often each timeframe is recalculated by the worker (minutes). */
export const RATING_REFRESH_MIN: Record<RatingTf, number> = {
  "5m": 1,
  "15m": 1,
  "30m": 5,
  "1h": 5,
  "2h": 5,
  "4h": 15,
  "1d": 15,
  "1w": 15,
  "1M": 15,
};
export const RATINGS_KEY = "ratings:latest";

export type Signal = -1 | 0 | 1;
export const RATING_LEVELS = ["strong_down", "down", "neutral", "up", "strong_up"] as const;
export type RatingLevel = (typeof RATING_LEVELS)[number];
export const RATING_LABEL: Record<RatingLevel, string> = {
  strong_down: "Strong down",
  down: "Down",
  neutral: "Neutral",
  up: "Up",
  strong_up: "Strong up",
};
/** The published bands: beyond ±0.5 strong, beyond ±0.1 leaning, otherwise neutral. */
export function ratingLevel(score: number): RatingLevel {
  if (score > 0.5) return "strong_up";
  if (score > 0.1) return "up";
  if (score < -0.5) return "strong_down";
  if (score < -0.1) return "down";
  return "neutral";
}

export interface IndicatorReading {
  name: string;
  /** Value shown (rounded), null when there is not enough history. */
  value: number | null;
  signal: Signal;
}

export interface GaugeDto {
  /** Mean of the signals, −1 … +1. */
  score: number;
  level: RatingLevel;
  up: number;
  down: number;
  neutral: number;
  items: IndicatorReading[];
}

export const MOODS = ["trending_up", "trending_down", "weak_trend", "ranging"] as const;
export type Mood = (typeof MOODS)[number];
export const MOOD_LABEL: Record<Mood, string> = {
  trending_up: "Trending up",
  trending_down: "Trending down",
  weak_trend: "Weak trend",
  ranging: "Ranging",
};
/** ADX at or above 25 is a trend (its side from +DI/−DI), below 20 a range, between a weak trend. */
export function moodOf(adx: number, plusDi: number, minusDi: number): Mood {
  if (adx >= 25) return plusDi >= minusDi ? "trending_up" : "trending_down";
  if (adx < 20) return "ranging";
  return "weak_trend";
}

export interface RatingDto {
  tf: RatingTf;
  /** Open time of the newest candle used (ms); it may still be forming, as on the chart. */
  lastCandle: number;
  computedAt: string;
  summary: GaugeDto;
  oscillators: GaugeDto;
  movingAverages: GaugeDto;
  adx: number | null;
  plusDi: number | null;
  minusDi: number | null;
  mood: Mood | null;
}

/** { SYMBOL: { tf: RatingDto } } */
export type RatingsSnapshot = Record<string, Partial<Record<RatingTf, RatingDto>>>;

export const RATINGS_DISCLAIMER =
  "Each of 26 indicators counts up, down or neutral by the standard published rule (for example RSI below 30 and rising counts up). The gauges show the balance of what the indicators read. They are not a forecast or a signal.";
