"use client";

import {
  ColorType,
  createChart,
  type IChartApi,
  LineSeries,
  LineStyle,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";
import { useThemeKey } from "@/features/theme/use-theme-key";
import { alpha, cssVar } from "./time-series-chart";

export interface LineSeriesInput {
  name: string;
  /** CSS variable for the colour, e.g. --pnl-profit. */
  colorVar: string;
  fallback: string;
  dashed?: boolean;
  /** Seconds since epoch (UTC), or YYYY-MM-DD business days. */
  points: Array<{ t: number | string; v: number }>;
}

const FORMATS = {
  usd: (v: number) => `${v < 0 ? "−" : ""}$${Math.round(Math.abs(v)).toLocaleString("en")}`,
  ratio: (v: number) => v.toFixed(2),
};

const toTime = (t: number | string): Time =>
  (typeof t === "number" ? (Math.floor(t) as UTCTimestamp) : t) as Time;

/**
 * Several lines on one chart (TradingView's open-source engine): What-If actual vs scenario,
 * backtest equity, correlation history. A legend names each line; a hidden table carries the data
 * for screen readers.
 */
export function LineChart({
  series,
  height = 260,
  zeroLine = false,
  label,
  format,
}: {
  series: LineSeriesInput[];
  height?: number;
  zeroLine?: boolean;
  label: string;
  /** Axis labels: whole dollars, or a plain ratio with two decimals. */
  format?: "usd" | "ratio";
}) {
  const container = useRef<HTMLDivElement>(null);
  const themeKey = useThemeKey();
  const data = useMemo(
    () =>
      series.map((s) => {
        // The library needs strictly increasing times: keep the last value per time.
        const byTime = new Map<string | number, number>();
        for (const p of s.points) byTime.set(p.t, p.v);
        return {
          ...s,
          rows: [...byTime.entries()]
            .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
            .map(([t, v]) => ({ time: toTime(t), value: v })),
        };
      }),
    [series],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: themeKey triggers a redraw in the new colours
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const muted = cssVar(el, "--color-ink-muted", "#8c99ac");
    const rule = cssVar(el, "--color-rule", "#233044");
    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: muted,
        fontFamily: "IBM Plex Mono, ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: alpha(rule, 0.6) } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true, timeVisible: true },
      localization: format ? { priceFormatter: FORMATS[format] } : undefined,
      handleScroll: false,
      handleScale: false,
    });
    for (const s of data) {
      const line = chart.addSeries(LineSeries, {
        color: cssVar(el, s.colorVar, s.fallback),
        lineWidth: 2,
        lineStyle: s.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      line.setData(s.rows);
      if (zeroLine && s === data[0])
        line.createPriceLine({ price: 0, color: rule, lineWidth: 1, axisLabelVisible: false });
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [data, themeKey, zeroLine, format]);

  return (
    <figure className="grid gap-2">
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4"
              style={{
                background: `var(${s.colorVar}, ${s.fallback})`,
                borderTop: s.dashed ? `2px dashed var(${s.colorVar}, ${s.fallback})` : undefined,
              }}
            />
            {s.name}
          </span>
        ))}
      </figcaption>
      <div ref={container} style={{ height }} className="w-full" role="img" aria-label={label} />
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>
            {data.flatMap((s) =>
              s.rows.slice(-50).map((r) => (
                <tr key={`${s.name}-${String(r.time)}`}>
                  <td>{s.name}</td>
                  <td>{String(r.time)}</td>
                  <td>{r.value}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
