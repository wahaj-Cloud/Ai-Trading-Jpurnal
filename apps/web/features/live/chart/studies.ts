import { bollinger, type Candle, ema, macd, rsi, sessionVwap, sma } from "@atc/ta/indicators";
import type { LiveCandle } from "../market";
import type { ChartSettings } from "./settings";

/** One indicator line: a value per candle (null while the indicator is warming up). */
export interface StudyLine {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  /** On the price chart, or in its own panel below it. */
  pane: "price" | "rsi" | "macd";
  style?: "line" | "histogram" | "dashed";
}

export const toTaCandles = (rows: readonly LiveCandle[]): Candle[] =>
  rows.map((c) => ({ t: c.time * 1000, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume }));

/**
 * Every indicator switched on in the settings, computed from the candles with the same formulas
 * the backtester and setup scanner use (@atc/ta).
 */
export function computeStudies(rows: readonly LiveCandle[], s: ChartSettings): StudyLine[] {
  const closes = rows.map((c) => c.close);
  const out: StudyLine[] = [];
  for (const m of s.mas) {
    if (!m.on) continue;
    out.push({
      key: m.id,
      label: `${m.kind} ${m.period}`,
      color: m.color,
      values: m.kind === "EMA" ? ema(closes, m.period) : sma(closes, m.period),
      pane: "price",
    });
  }
  if (s.bollinger.on) {
    const b = bollinger(closes, s.bollinger.period, s.bollinger.mult);
    const label = `BB ${s.bollinger.period} ${s.bollinger.mult}`;
    out.push(
      { key: "bb-u", label: `${label} upper`, color: "#38bdf8", values: b.upper, pane: "price" },
      {
        key: "bb-m",
        label: `${label} basis`,
        color: "#f472b6",
        values: b.mid,
        pane: "price",
        style: "dashed",
      },
      { key: "bb-l", label: `${label} lower`, color: "#38bdf8", values: b.lower, pane: "price" },
    );
  }
  if (s.vwap.on) {
    out.push({
      key: "vwap",
      label: "VWAP (daily)",
      color: "#eab308",
      values: sessionVwap(toTaCandles(rows)),
      pane: "price",
    });
  }
  if (s.rsi.on) {
    out.push({
      key: "rsi",
      label: `RSI ${s.rsi.period}`,
      color: "#a78bfa",
      values: rsi(closes, s.rsi.period),
      pane: "rsi",
    });
  }
  if (s.macd.on) {
    const m = macd(closes, s.macd.fast, s.macd.slow, s.macd.signal);
    const label = `MACD ${s.macd.fast} ${s.macd.slow} ${s.macd.signal}`;
    out.push(
      {
        key: "macd-h",
        label: `${label} histogram`,
        color: "#64748b",
        values: m.hist,
        pane: "macd",
        style: "histogram",
      },
      { key: "macd", label, color: "#3b82f6", values: m.macd, pane: "macd" },
      { key: "macd-s", label: "Signal", color: "#f97316", values: m.signal, pane: "macd" },
    );
  }
  return out;
}

/** The panels below the price chart, in display order. */
export function studyPanes(s: ChartSettings): Array<"rsi" | "macd"> {
  return [...(s.rsi.on ? (["rsi"] as const) : []), ...(s.macd.on ? (["macd"] as const) : [])];
}
