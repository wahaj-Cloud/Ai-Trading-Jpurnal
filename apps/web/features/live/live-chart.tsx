"use client";

import type { OpenPositionDto } from "@atc/shared";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineStyle,
  type Time,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { alpha, cssVar } from "@/features/charts/time-series-chart";
import { useThemeKey } from "@/features/theme/use-theme-key";
import {
  BlockedError,
  type FeedStatus,
  fetchCandles,
  type LiveCandle,
  type LiveInterval,
  useBinanceStream,
} from "./binance";

/** Unrealised P&L of a linear USDT position at `price` (null when size is unknown). */
export function livePnl(p: OpenPositionDto, price: number): number | null {
  if (!p.entryPrice || !p.quantity || p.settleAsset !== p.quoteAsset) return null;
  const dir = p.direction === "LONG" ? 1 : -1;
  return (price - Number(p.entryPrice)) * Number(p.quantity) * dir;
}

const usd = (v: number) =>
  `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Live candlestick chart: history from Binance's REST API, then every price update from its
 * WebSocket (several a second) drawn straight onto the chart. Your open positions on this coin show
 * as entry lines with live profit or loss.
 */
export function LiveChart({
  symbol,
  interval,
  positions,
  onStatus,
  height = 460,
}: {
  symbol: string;
  interval: LiveInterval;
  positions: OpenPositionDto[];
  onStatus?: (s: FeedStatus | "loading" | "error") => void;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lines = useRef<Array<{ p: OpenPositionDto; line: IPriceLine }>>([]);
  const lastLineUpdate = useRef(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const themeKey = useThemeKey();

  // biome-ignore lint/correctness/useExhaustiveDependencies: themeKey redraws in the new colours
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setReady(false);
    setError(null);
    onStatus?.("loading");
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
      grid: { vertLines: { color: alpha(rule, 0.25) }, horzLines: { color: alpha(rule, 0.5) } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 6 },
      crosshair: {
        vertLine: { color: muted, style: LineStyle.Dashed },
        horzLine: { color: muted, style: LineStyle.Dashed },
      },
    });
    const s = chart.addSeries(CandlestickSeries, {
      upColor: profit,
      downColor: loss,
      wickUpColor: profit,
      wickDownColor: loss,
      borderVisible: false,
    });
    series.current = s;
    const ctrl = new AbortController();
    fetchCandles(symbol, interval, 500, ctrl.signal)
      .then((rows: LiveCandle[]) => {
        s.setData(rows.map((c) => ({ ...c, time: c.time as Time })));
        // Price precision from the data (meme coins need many decimals).
        const last = rows.at(-1)?.close ?? 1;
        const precision = last >= 1000 ? 1 : last >= 1 ? 3 : last >= 0.01 ? 5 : 8;
        s.applyOptions({
          priceFormat: { type: "price", precision, minMove: 10 ** -precision },
        });
        chart.timeScale().fitContent();
        chart.timeScale().scrollToRealTime();
        lines.current = positions
          .filter((p) => p.symbol === symbol && p.entryPrice)
          .map((p) => ({
            p,
            line: s.createPriceLine({
              price: Number(p.entryPrice),
              color: p.direction === "LONG" ? profit : loss,
              lineWidth: 2,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: `Your ${p.direction.toLowerCase()}`,
            }),
          }));
        setReady(true);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(
          err instanceof BlockedError
            ? "Binance does not serve live prices in your region."
            : "Could not load the chart. Check your connection and try again.",
        );
        onStatus?.("error");
      });
    return () => {
      ctrl.abort();
      series.current = null;
      lines.current = [];
      chart.remove();
    };
  }, [symbol, interval, themeKey]);

  const status = useBinanceStream(
    ready ? [`${symbol.toLowerCase()}@kline_${interval}`] : [],
    (d) => {
      const k = (d as { k?: { t: number; o: string; h: string; l: string; c: string } }).k;
      if (!k || !series.current) return;
      const close = Number(k.c);
      series.current.update({
        time: Math.floor(k.t / 1000) as Time,
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close,
      });
      // Entry-line labels show live P&L; refreshed at most once a second.
      const now = Date.now();
      if (now - lastLineUpdate.current > 1000) {
        lastLineUpdate.current = now;
        for (const { p, line } of lines.current) {
          const pnl = livePnl(p, close);
          line.applyOptions({
            title: `Your ${p.direction.toLowerCase()}${pnl === null ? "" : ` ${usd(pnl)}`}`,
          });
        }
      }
    },
  );

  useEffect(() => {
    if (ready) onStatus?.(status);
  }, [ready, status, onStatus]);

  return (
    <div className="relative">
      <div
        ref={box}
        style={{ height }}
        className="w-full"
        role="img"
        aria-label={`Live ${symbol} ${interval} candlestick chart`}
      />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink-muted">
          {error}
        </div>
      )}
    </div>
  );
}
