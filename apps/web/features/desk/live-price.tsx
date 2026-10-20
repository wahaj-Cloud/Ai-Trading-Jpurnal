"use client";

import { signedPct } from "@atc/shared";
import { useState } from "react";
import {
  formatPrice,
  type MiniTicker,
  parseMiniTicker,
  useBinanceStream,
} from "@/features/live/binance";
import { cn } from "@/lib/cn";

const signed = (v: number) => signedPct(v, 2);

/**
 * The desk's price, live from Binance's ticker stream (rolling 24h change, as on the exchange).
 * Until the stream answers, or where Binance is blocked, the price saved with the desk is shown.
 */
export function LivePrice({
  symbol,
  price,
  change24hPct,
}: {
  symbol: string;
  price: number;
  change24hPct: number | null;
}) {
  const [t, setT] = useState<MiniTicker | null>(null);
  const status = useBinanceStream([`${symbol.toLowerCase()}@miniTicker`], (d) => {
    const next = parseMiniTicker(d as never);
    // Only this market's ticker (never another stream's price).
    if (next.symbol === symbol && next.price > 0) setT(next);
  });
  const live = t !== null && status === "live";
  const shown = t?.price ?? price;
  const change = t ? t.change * 100 : change24hPct;
  return (
    <p className="flex flex-wrap items-baseline gap-x-3">
      <span className="figures text-3xl font-semibold">{formatPrice(shown)}</span>
      {change !== null && (
        <span className={cn("figures text-sm", change >= 0 ? "text-profit" : "text-loss")}>
          {signed(change)} 24h
        </span>
      )}
      <span className="flex items-center gap-1 text-xs text-ink-faint">
        <span
          aria-hidden="true"
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            live ? "animate-pulse bg-profit" : "bg-ink-faint",
          )}
        />
        {live ? "Live" : "At last update"}
      </span>
    </p>
  );
}
