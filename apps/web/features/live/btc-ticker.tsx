"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import {
  formatChange,
  formatPrice,
  type MiniTicker,
  parseMiniTicker,
  useBinanceStream,
} from "./binance";

const STREAMS = ["btcusdt@miniTicker"];

/** Live BTC price in the top bar; opens Live Markets. Hidden where Binance is not reachable. */
export function BtcTicker() {
  const [t, setT] = useState<MiniTicker | null>(null);
  const status = useBinanceStream(STREAMS, (d) => setT(parseMiniTicker(d as never)));
  if (status === "blocked" || !t) return null;
  return (
    <Link
      href="/live"
      title="Live Markets"
      className="figures hidden h-8 items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors hover:bg-hi/[0.08] md:inline-flex"
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "live" ? "animate-pulse bg-profit" : "bg-ink-faint",
        )}
      />
      <span className="text-ink-muted">BTC</span>
      <span className="font-semibold text-ink tabular-nums">{formatPrice(t.price)}</span>
      <span className={cn("tabular-nums", t.change >= 0 ? "text-profit" : "text-loss")}>
        {formatChange(t.change)}
      </span>
    </Link>
  );
}
