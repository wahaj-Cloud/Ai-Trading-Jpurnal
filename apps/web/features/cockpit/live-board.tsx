"use client";

import {
  applyLiveToScalpCoin,
  buildScalpReadout,
  type CockpitDto,
  type CockpitTf,
  type ExchangeId,
  nearestLevels,
  type PlanSnapshot,
} from "@atc/shared";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Panel } from "@/features/analytics/metric";
import { formatPrice } from "@/features/live/market";
import { FreshnessBadge } from "@/features/live-flow/freshness";
import { useLiveView } from "@/features/live-flow/use-live-view";
import { useLiveHeadlines } from "@/features/news/live-news";
import { BookPressure } from "@/features/scalp/views";
import { PlanCard } from "./plan-card";
import { Flags, KeyNumbers, Ladder, ReadoutTable, StrengthStrip, Tally } from "./views";

const HOT_MS = 30 * 60_000;

/** The clock, starting at the server's render time (same first render), then every second. */
function useClock(renderedAt: number) {
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * The live part of the Cockpit. Every second the readings are counted again with the same rules
 * (`buildScalpReadout`): the market's live figures (buying and selling, open interest, price, VWAP
 * distance, funding, spread, activity), the clock (so "CPI in 4 min" counts down and appears 30
 * minutes before a release) and any high-impact headline that has just arrived on the news stream.
 */
export function CockpitBoard({
  dto,
  tf,
  renderedAt,
  gauges,
  bigMoney,
  fromAlert = null,
  exchanges = [],
}: {
  dto: CockpitDto;
  tf: CockpitTf;
  renderedAt: number;
  /** Server-rendered panels that sit between the live parts. */
  gauges: ReactNode;
  bigMoney: ReactNode;
  /** The plan carried by an alert's link, if the page was opened from one. */
  fromAlert?: PlanSnapshot | null;
  exchanges?: ExchangeId[];
}) {
  const live = useLiveView({ view: "cockpit", s: dto.symbol, enabled: dto.coin !== null });
  const now = useClock(renderedAt);
  const headlines = useLiveHeadlines();
  const lv = live.data;
  const liveCoin = lv?.coins.find((c) => c.s === dto.symbol) ?? null;
  const showLive = live.status === "live" && liveCoin !== null;

  const view = useMemo<CockpitDto>(() => {
    if (!dto.coin) return dto;
    const coin = liveCoin ? applyLiveToScalpCoin(dto.coin, liveCoin) : dto.coin;
    // Headlines that broke after the page loaded, one per story, not already counted.
    const known = new Set(dto.headlines.map((h) => h.title));
    const fresh = new Set(
      headlines
        .filter(
          (h) =>
            h.impact === "HIGH" &&
            now - Date.parse(h.publishedAt) <= HOT_MS &&
            now >= Date.parse(h.publishedAt) &&
            !known.has(h.title),
        )
        .map((h) => h.title),
    ).size;
    const r = buildScalpReadout({
      tf,
      coin,
      now,
      computedAt: liveCoin && lv ? new Date(lv.at).toISOString() : dto.computedAt,
      events: dto.events,
      hotHeadlines: dto.hotHeadlines + fresh,
      whales: dto.whales,
      liquidations: dto.liquidations,
      bias1h: dto.bias1h,
    });
    const lvls = nearestLevels(coin);
    const dist = <T extends { price: number } | null>(x: T) =>
      x ? { ...x, distPct: (x.price / coin.price - 1) * 100 } : x;
    return {
      ...dto,
      coin,
      rows: r.rows,
      flags: r.flags,
      tally: r.tally,
      levelAbove: lvls.above,
      levelBelow: lvls.below,
      liqAbove: dist(dto.liqAbove),
      liqBelow: dist(dto.liqBelow),
    };
  }, [dto, liveCoin, lv, now, tf, headlines]);

  const c = view.coin;
  if (!c) return null;
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-3xl font-semibold">{view.name}</h2>
        <span className="figures text-2xl text-ink-muted">{formatPrice(c.price)}</span>
        {view.open.length > 0 && (
          <span className="rounded-full bg-coach/15 px-3 py-1 text-sm text-coach">
            You hold{" "}
            {view.open
              .map(
                (p) =>
                  `${p.direction === "LONG" ? "a long" : "a short"}${p.entryPrice ? ` from ${formatPrice(Number(p.entryPrice))}` : ""}`,
              )
              .join(", ")}
          </span>
        )}
        <FreshnessBadge
          className="self-center"
          at={showLive && lv ? lv.at : view.computedAt}
          live={showLive}
          every="every minute"
          staleAfterMs={3 * 60_000}
        />
      </div>

      <Flags flags={view.flags} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="surface grid content-start gap-5 rounded-[var(--radius-surface)] p-5">
          <Tally dto={view} />
          <StrengthStrip dto={view} />
          <KeyNumbers dto={view} />
        </section>
        <section aria-label="Readings" className="surface rounded-[var(--radius-surface)] p-5">
          <h2 className="mb-3 font-semibold">Readings on {tf}</h2>
          <ReadoutTable rows={view.rows} />
          <p className="mt-3 text-xs text-ink-faint">
            {showLive
              ? "Counted again every second from live figures; whale orders, liquidations and the trend update every minute."
              : live.status === "connecting"
                ? "Connecting to the live feed…"
                : "Live feed unavailable: counted from the 1-minute scan."}
          </p>
        </section>
      </div>

      <PlanCard
        symbol={view.symbol}
        price={c.price}
        atr5m={c.volatility.atr5m}
        fromAlert={fromAlert}
        exchanges={exchanges}
      />

      {gauges}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Levels and liquidation pools">
          <Ladder dto={view} />
          <p className="mt-2 text-xs text-ink-faint">
            Nearest of today's high/low, the Asia range, the 24h high/low and VWAP; purple are the
            biggest estimated liquidation pools within 3%. "Ranges" = typical 5-minute ranges away.
          </p>
        </Panel>
        {bigMoney}
        <Panel title="Order book near price">
          {c.book ? (
            <BookPressure book={c.book} />
          ) : (
            <p className="text-sm text-ink-muted">
              Order books are read for the 20 most traded coins, gold and silver.
            </p>
          )}
        </Panel>
      </div>
    </>
  );
}
