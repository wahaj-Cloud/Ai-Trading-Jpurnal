"use client";

import { useRef, useState } from "react";
import {
  formatChange,
  formatPrice,
  parseMiniTicker,
  useBinanceStream,
} from "@/features/live/binance";
import { cn } from "@/lib/cn";

const COINS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "TONUSDT",
  "SUIUSDT",
  "LTCUSDT",
];
const STREAMS = ["!miniTicker@arr"];

/**
 * A scrolling strip of live futures prices straight from Binance: proof on the landing page that
 * the app works with real, live market data. Hidden where Binance is not reachable.
 */
export function LiveStrip() {
  const prices = useRef(new Map<string, { price: number; change: number }>());
  const [, setTick] = useState(0);
  const status = useBinanceStream(STREAMS, (d) => {
    if (!Array.isArray(d)) return;
    let changed = false;
    for (const raw of d) {
      const t = parseMiniTicker(raw);
      if (COINS.includes(t.symbol)) {
        prices.current.set(t.symbol, { price: t.price, change: t.change });
        changed = true;
      }
    }
    if (changed) setTick((n) => n + 1);
  });
  const rows = COINS.flatMap((s) => {
    const p = prices.current.get(s);
    return p ? [{ s, ...p }] : [];
  });
  if (status === "blocked" || rows.length < 4) return <div className="h-12" aria-hidden="true" />;

  const items = rows.map((r) => (
    <span
      key={r.s}
      className="figures inline-flex items-center gap-2 px-5 text-sm whitespace-nowrap"
    >
      <span className="font-semibold text-ink">{r.s.replace(/USDT$/, "")}</span>
      <span className="tabular-nums text-ink-muted">{formatPrice(r.price)}</span>
      <span className={cn("tabular-nums", r.change >= 0 ? "text-profit" : "text-loss")}>
        {formatChange(r.change)}
      </span>
    </span>
  ));
  return (
    <section
      aria-label="Live futures prices"
      className="relative flex h-12 items-center overflow-hidden border-y border-hi/10 bg-hi/[0.03]"
    >
      <span className="relative z-10 flex h-full shrink-0 items-center gap-2 bg-sheet px-4 text-xs font-semibold tracking-wide text-profit uppercase shadow-[12px_0_16px_-4px_var(--color-sheet)]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-profit" aria-hidden="true" />
        Live
      </span>
      <div className="landing-marquee flex">
        <div className="flex">{items}</div>
        <div className="flex" aria-hidden="true">
          {items}
        </div>
      </div>
    </section>
  );
}
