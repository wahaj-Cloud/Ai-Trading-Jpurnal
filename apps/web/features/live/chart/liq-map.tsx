"use client";

import {
  EXCHANGE_CATALOG,
  LIQ_MAP_DISCLAIMER,
  LIQ_MAP_FREE_SYMBOL,
  LIQ_MAP_WINDOW_SPEC,
  LIQ_MAP_WINDOWS,
  type LiqMapWindow,
  type LiquidationMapDto,
  type LiquidationMapResponse,
} from "@atc/shared";
import { Flame, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { getLiquidationMapAction } from "../actions";
import { formatPrice } from "../market";
import { heatColor } from "./heatmap";

const REFRESH_MS = 5 * 60_000;
const compactUsd = (v: number) =>
  `$${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`;

export type LiqMapState = LiquidationMapResponse | { status: "error" } | { status: "loading" };

/** Loads the map for a market while it is switched on, and refreshes it every 5 minutes. */
export function useLiquidationMap(symbol: string, on: boolean, window: LiqMapWindow): LiqMapState {
  const [state, setState] = useState<LiqMapState>({ status: "loading" });
  useEffect(() => {
    if (!on) return;
    let alive = true;
    setState({ status: "loading" });
    const load = () =>
      getLiquidationMapAction(symbol, window).then((r) => {
        if (alive) setState(r);
      });
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [symbol, on, window]);
  return state;
}

export const mapOf = (s: LiqMapState): LiquidationMapDto | null =>
  s.status === "ok" ? s.map : null;

/** Under the chart: what the colours mean, the biggest clusters, and the data behind them. */
export function LiqMapCard({
  state,
  window,
  onWindow,
  onClose,
  price,
}: {
  state: LiqMapState;
  window: LiqMapWindow;
  onWindow: (w: LiqMapWindow) => void;
  onClose: () => void;
  price: number | null;
}) {
  const map = mapOf(state);
  const above =
    map?.clusters.filter((c) => c.side === "short").sort((a, b) => a.price - b.price) ?? [];
  const below =
    map?.clusters.filter((c) => c.side === "long").sort((a, b) => b.price - a.price) ?? [];
  const ageMin = map
    ? Math.max(0, Math.round((Date.now() - Date.parse(map.computedAt)) / 60_000))
    : 0;
  const pct = (p: number) =>
    price ? `${p >= price ? "+" : "−"}${Math.abs((p / price - 1) * 100).toFixed(1)}%` : "";

  return (
    <section
      aria-label="Estimated liquidation map"
      className="grid gap-3 rounded-[var(--radius-control)] border border-rule p-3 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <Flame className="h-4 w-4 text-[#f59e0b]" aria-hidden="true" />
          Liquidation map <span className="font-normal text-ink-faint">(estimated)</span>
        </h3>
        <div className="flex items-center gap-2">
          <fieldset className="flex gap-0.5 rounded-full border border-rule p-0.5">
            <legend className="sr-only">Period</legend>
            {LIQ_MAP_WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={w === window}
                onClick={() => onWindow(w)}
                title={LIQ_MAP_WINDOW_SPEC[w].label}
                className={cn(
                  "h-7 rounded-full px-2.5 text-xs",
                  w === window
                    ? "bg-coach/15 font-medium text-ink"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {w}
              </button>
            ))}
          </fieldset>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-ink-muted hover:bg-hi/[0.08] hover:text-ink"
            title="Hide the liquidation map"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Hide the liquidation map</span>
          </button>
        </div>
      </div>

      {state.status === "loading" && <p className="text-ink-muted">Loading the map…</p>}
      {state.status === "error" && (
        <p className="text-ink-muted">The map could not be loaded. It retries every 5 minutes.</p>
      )}
      {state.status === "locked" && (
        <p className="text-ink-muted">
          The free plan maps Bitcoin. Liquidation maps for every market (including gold and silver)
          come with Pro and Premium.{" "}
          <Link href="/billing" className="text-coach underline-offset-4 hover:underline">
            See plans
          </Link>{" "}
          or switch to{" "}
          <Link
            href={`/live?s=${LIQ_MAP_FREE_SYMBOL}`}
            className="text-coach underline-offset-4 hover:underline"
          >
            BTC
          </Link>
          .
        </p>
      )}
      {state.status === "unavailable" && (
        <p className="text-ink-muted">
          {state.reason === "pending"
            ? "The first map for this market is being built. It appears within 5 minutes."
            : "Liquidation maps cover BTC, ETH, SOL, XRP, DOGE, BNB, SUI, ADA, LINK, AVAX, gold and silver."}
        </p>
      )}

      {map && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-muted">
            <span className="flex items-center gap-2">
              Less
              <span
                aria-hidden="true"
                className="h-2.5 w-28 rounded-full"
                style={{
                  background: `linear-gradient(90deg, ${[40, 100, 160, 220, 255]
                    .map((q) => {
                      const [r, g, b, a] = heatColor(q);
                      return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
                    })
                    .join(",")})`,
                }}
              />
              More value at risk
            </span>
            <span>
              Shorts at risk above {compactUsd(map.totalShortUsd)} · longs below{" "}
              {compactUsd(map.totalLongUsd)}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["Above the price (short liquidations)", above, "text-loss"],
                ["Below the price (long liquidations)", below, "text-profit"],
              ] as const
            ).map(([title, rows, tone]) => (
              <div key={title}>
                <p className="text-xs text-ink-faint">{title}</p>
                {rows.length === 0 ? (
                  <p className="mt-1 text-ink-muted">No large clusters.</p>
                ) : (
                  <ul className="mt-1 grid gap-1">
                    {rows.map((c) => (
                      <li
                        key={`${c.side}${c.price}`}
                        className="figures flex justify-between gap-3"
                      >
                        <span>
                          {formatPrice(c.price)}{" "}
                          <span className="text-xs text-ink-faint">{pct(c.price)}</span>
                        </span>
                        <span className={tone}>≈ {compactUsd(c.usd)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-ink-faint">
            Sources:{" "}
            {map.sources
              .map((s) => `${EXCHANGE_CATALOG[s.exchange].name} ${s.ok ? "✓" : "(not listed)"}`)
              .join(" · ")}{" "}
            · updated {ageMin <= 1 ? "just now" : `${ageMin} min ago`}. {LIQ_MAP_DISCLAIMER}
          </p>
        </>
      )}
    </section>
  );
}
