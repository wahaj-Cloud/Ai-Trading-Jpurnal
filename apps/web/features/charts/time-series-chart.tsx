"use client";

import {
  AreaSeries,
  BaselineSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  LineStyle,
  type MouseEventParams,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney, formatPnl } from "@/features/trades/format";

export interface Point {
  /** YYYY-MM-DD (a calendar day in the trader's timezone). */
  date: string;
  value: number;
}

type Kind = "equity" | "daily" | "drawdown";

const LABELS: Record<Kind, string> = {
  equity: "Cumulative net P&L",
  daily: "Net P&L per day",
  drawdown: "Drawdown from peak",
};

function cssVar(el: HTMLElement, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

const dayLabel = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const formatDay = (date: string) => dayLabel.format(new Date(`${date}T00:00:00Z`));

/**
 * Time-series chart on TradingView's open-source charting library (the same engine as the charts
 * traders already know). Polarity is encoded by position around the zero line as well as by colour,
 * so the chart stays readable for colour-blind users; a crosshair readout gives exact values.
 */
export function TimeSeriesChart({
  kind,
  points,
  height = 260,
}: {
  kind: Kind;
  points: Point[];
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const last = points.at(-1) ?? null;

  const data = useMemo(
    () => points.map((p) => ({ time: p.date as Time, value: p.value })),
    [points],
  );

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const profit = cssVar(el, "--pnl-profit", "#26b07e");
    const loss = cssVar(el, "--pnl-loss", "#e5484d");
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
      grid: {
        vertLines: { visible: false },
        horzLines: { color: `${rule}99`, style: LineStyle.Solid },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        vertLine: { color: muted, labelVisible: false, style: LineStyle.Dashed },
        horzLine: { color: muted, labelVisible: true, style: LineStyle.Dashed },
      },
      handleScroll: false,
      handleScale: false,
    });

    let series: ISeriesApi<SeriesType>;
    if (kind === "equity") {
      series = chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: 0 },
        topLineColor: profit,
        topFillColor1: `${profit}40`,
        topFillColor2: `${profit}05`,
        bottomLineColor: loss,
        bottomFillColor1: `${loss}05`,
        bottomFillColor2: `${loss}40`,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      series.setData(data);
    } else if (kind === "daily") {
      series = chart.addSeries(HistogramSeries, {
        priceLineVisible: false,
        lastValueVisible: false,
        base: 0,
      });
      series.setData(data.map((d) => ({ ...d, color: d.value >= 0 ? profit : loss })));
    } else {
      series = chart.addSeries(AreaSeries, {
        lineColor: loss,
        topColor: `${loss}05`,
        bottomColor: `${loss}40`,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        invertFilledArea: true,
      });
      // Drawdown is plotted below zero: deeper falls sit lower.
      series.setData(data.map((d) => ({ ...d, value: -Math.abs(d.value) })));
    }
    series.createPriceLine({
      price: 0,
      color: rule,
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: false,
    });
    // Whole units once values reach the hundreds; cents only for small accounts.
    const largest = Math.max(...data.map((d) => Math.abs(d.value)), 0);
    series.applyOptions({
      priceFormat:
        largest >= 100
          ? { type: "price", precision: 0, minMove: 1 }
          : { type: "price", precision: 2, minMove: 0.01 },
    });
    chart.timeScale().fitContent();

    const onMove = (param: MouseEventParams<Time>) => {
      const value = param.seriesData.get(series) as { value?: number } | undefined;
      if (!param.time || value?.value === undefined) {
        setHover(null);
        return;
      }
      setHover({ date: String(param.time), value: value.value });
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
    };
  }, [kind, data]);

  const shown = hover ?? last;
  const valueText = shown
    ? kind === "drawdown"
      ? `−${formatMoney(String(Math.abs(shown.value)))}`
      : formatPnl(String(shown.value))
    : "—";

  return (
    <figure className="grid gap-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 text-xs text-ink-muted">
        <span>{LABELS[kind]}</span>
        <span className="figures" aria-live="polite">
          {shown ? `${formatDay(shown.date)} · ` : ""}
          <span className="text-sm text-ink">{valueText}</span>
        </span>
      </figcaption>
      <div
        ref={container}
        style={{ height }}
        className="w-full"
        role="img"
        aria-label={`${LABELS[kind]} chart, ${points.length} days. A table follows.`}
      />
      <table className="sr-only">
        <caption>{LABELS[kind]}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <td>{p.date}</td>
              <td>{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
