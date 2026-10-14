"use client";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import { useThemeKey } from "@/features/theme/use-theme-key";
import { alpha, cssVar } from "./time-series-chart";

export interface ChartCandle {
  /** Open time, ms. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface ChartMarker {
  /** Candle open time, ms. */
  t: number;
  kind: "match" | "entry" | "exit-win" | "exit-loss";
  text?: string;
}

const sec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

/** Candlestick chart with markers: setup matches in the preview, entries/exits in Strategy Lab. */
export function CandleChart({
  candles,
  markers,
  height = 360,
  label,
}: {
  candles: ChartCandle[];
  markers: ChartMarker[];
  height?: number;
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const themeKey = useThemeKey();

  // biome-ignore lint/correctness/useExhaustiveDependencies: themeKey triggers a redraw in the new colours
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const profit = cssVar(el, "--pnl-profit", "#26b07e");
    const loss = cssVar(el, "--pnl-loss", "#e5484d");
    const coach = cssVar(el, "--color-coach", "#7c8cff");
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
      grid: { vertLines: { visible: false }, horzLines: { color: alpha(rule, 0.5) } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: profit,
      downColor: loss,
      wickUpColor: profit,
      wickDownColor: loss,
      borderVisible: false,
      priceLineVisible: false,
    });
    series.setData(
      candles.map((c) => ({ time: sec(c.t) as Time, open: c.o, high: c.h, low: c.l, close: c.c })),
    );
    const list: SeriesMarker<Time>[] = [...markers]
      .sort((a, b) => a.t - b.t)
      .map((m) => ({
        time: sec(m.t) as Time,
        position: m.kind === "entry" || m.kind === "match" ? "belowBar" : "aboveBar",
        shape: m.kind === "match" ? "circle" : m.kind === "entry" ? "arrowUp" : "arrowDown",
        color: m.kind === "exit-loss" ? loss : m.kind === "exit-win" ? profit : coach,
        text: m.text,
      }));
    createSeriesMarkers(series, list);
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, markers, themeKey]);

  return (
    <div ref={container} style={{ height }} className="w-full" role="img" aria-label={label} />
  );
}
