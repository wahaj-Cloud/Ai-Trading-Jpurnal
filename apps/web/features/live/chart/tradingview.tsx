"use client";

import { useEffect, useRef } from "react";
import type { LiveInterval } from "../market";

const TV_INTERVAL: Record<LiveInterval, string> = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "2h": "120",
  "4h": "240",
  "6h": "360",
  "12h": "720",
  "1d": "D",
  "1w": "W",
};

/** Spot feeds offered for TradFi perpetuals, as TradingView symbols. */
export const SPOT_ALTERNATIVES: Record<string, { tv: string; label: string }> = {
  XAUUSDT: { tv: "OANDA:XAUUSD", label: "Spot XAUUSD (OANDA)" },
  XAGUSDT: { tv: "OANDA:XAGUSD", label: "Spot XAGUSD (OANDA)" },
};

/** TradingView symbol for a Binance USDT perpetual, e.g. BINANCE:BTCUSDT.P. */
export const tvSymbol = (symbol: string) => `BINANCE:${symbol}.P`;

/**
 * TradingView's free Advanced Chart widget: the full TradingView toolset (every drawing tool and
 * 100+ indicators) inside WickMentor. It runs in TradingView's own frame, so it cannot show the
 * trader's positions; our own chart does that. TradingView requires the attribution link.
 */
export function TradingViewChart({
  symbol,
  interval,
  height,
}: {
  /** TradingView symbol, e.g. BINANCE:BTCUSDT.P or OANDA:XAUUSD. */
  symbol: string;
  interval: LiveInterval;
  height: number | "100%";
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.innerHTML = "";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    el.appendChild(widget);
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.type = "text/javascript";
    const dark = document.documentElement.dataset.mode !== "light";
    script.textContent = JSON.stringify({
      autosize: true,
      symbol,
      interval: TV_INTERVAL[interval],
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
      theme: dark ? "dark" : "light",
      style: "1",
      locale: "en",
      // Solid, so the loading message behind the widget is hidden once the chart appears.
      backgroundColor: dark ? "#0a0e24" : "#ffffff",
      allow_symbol_change: true,
      hide_side_toolbar: false,
      withdateranges: true,
      details: false,
      calendar: false,
      save_image: true,
      support_host: "https://www.tradingview.com",
    });
    el.appendChild(script);
    return () => {
      el.innerHTML = "";
    };
  }, [symbol, interval]);

  return (
    <div className="grid gap-1">
      <div className="relative" style={{ height }}>
        <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink-muted">
          Loading TradingView… If nothing appears, TradingView may be blocked on your network;
          switch back to the WickMentor chart.
        </p>
        <div
          ref={box}
          className="tradingview-widget-container relative h-full w-full overflow-hidden rounded-[var(--radius-control)]"
        />
      </div>
      <p className="text-right text-[11px] text-ink-faint">
        <a
          href="https://www.tradingview.com/"
          rel="noopener nofollow"
          target="_blank"
          className="hover:text-ink-muted"
        >
          Charts by TradingView
        </a>
      </p>
    </div>
  );
}
