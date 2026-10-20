"use client";

import {
  applyLiveToScalpCoin,
  DESK_SYMBOLS,
  ORDERFLOW_WINDOW_LABEL,
  ORDERFLOW_WINDOWS,
  SCALP_BOOK_COINS,
  SCALP_PINNED,
  type ScalpResponse,
  STRENGTH_THRESHOLDS,
  sessionAt,
  UNUSUAL_VOLUME,
} from "@atc/shared";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Panel } from "@/features/analytics/metric";
import { formatPrice } from "@/features/live/market";
import { FreshnessBadge } from "@/features/live-flow/freshness";
import { useLiveView } from "@/features/live-flow/use-live-view";
import { coinName, pct } from "@/features/orderflow/format";
import { cn } from "@/lib/cn";
import {
  Alignment,
  BookPressure,
  filterCoins,
  LevelsCard,
  MetalNote,
  NewsRisk,
  SCALP_FILTERS,
  type ScalpFilter,
  StrengthGrid,
  TimeframeStrip,
  VolatilityCard,
} from "./views";

function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap",
        active
          ? "border-coach/60 bg-coach/15 font-medium text-ink"
          : "border-rule text-ink-muted hover:bg-hi/[0.06] hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
};

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
 * The Scalping desk below its header. The minute scan arrives from the server; the live stream then
 * updates every coin each second: buying and selling on 5m to 1H, open interest (every 5 s), price,
 * VWAP distance, funding, spread, activity and today's extremes. Book bands and 4H/1D stay per scan.
 */
export function ScalpBoard({
  initial,
  wanted,
  filter,
  renderedAt,
}: {
  initial: ScalpResponse;
  wanted: string | null;
  filter: ScalpFilter;
  renderedAt: number;
}) {
  const live = useLiveView({ view: "scalp", enabled: initial.coins.length > 0 });
  const now = useClock(renderedAt);
  const lv = live.data;
  const data = useMemo<ScalpResponse>(() => {
    if (!lv) return initial;
    const by = new Map(lv.coins.map((c) => [c.s, c]));
    return {
      ...initial,
      coins: initial.coins.map((c) => {
        const l = by.get(c.symbol);
        return l ? applyLiveToScalpCoin(c, l) : c;
      }),
    };
  }, [initial, lv]);
  const mine = useMemo(() => new Set(data.mine), [data.mine]);
  const coin =
    data.coins.find((c) => c.symbol === wanted) ??
    data.coins.find((c) => mine.has(c.symbol)) ??
    data.coins[0];
  const href = (patch: { s?: string; f?: string }) => {
    const p = new URLSearchParams();
    const s = patch.s ?? coin?.symbol;
    const f = patch.f ?? (filter === "all" ? undefined : filter);
    if (s) p.set("s", s);
    if (f && f !== "all") p.set("f", f);
    return `/scalp?${p}`;
  };
  const quick = [
    ...new Set([
      ...data.mine,
      ...data.coins.slice(0, 2).map((c) => c.symbol),
      ...SCALP_PINNED,
      ...data.coins.slice(2, 8).map((c) => c.symbol),
    ]),
  ].filter((s) => data.coins.some((c) => c.symbol === s));
  const session = sessionAt(new Date(now));
  const rows = filterCoins(data.coins, filter, mine);
  const showLive = live.status === "live" && lv !== null;
  const stale = !showLive && data.computedAt && now - Date.parse(data.computedAt) > 5 * 60_000;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-faint">
        <FreshnessBadge
          at={showLive ? (lv?.at ?? null) : (data.computedAt ?? null)}
          live={showLive}
          every="every minute"
          staleAfterMs={3 * 60_000}
        />
        <span>
          {showLive
            ? "Strength, price, open interest (every 5 s), spread and activity update every second; order-book bands every minute."
            : live.status === "connecting"
              ? "Connecting to the live feed…"
              : "Live feed unavailable: showing the 1-minute scan."}
        </span>
      </div>
      <div className="grid gap-2">
        <p className="text-sm text-ink-muted">
          Session now: <strong className="text-ink">{session.label}</strong>
        </p>
        <NewsRisk events={data.events} now={now} />
      </div>

      {stale && (
        <p className="rounded-[var(--radius-control)] border border-[#f59e0b]/50 bg-[#f59e0b]/10 px-4 py-2 text-sm">
          These figures are from {ago(data.computedAt ?? "")}: the data feed is catching up.
        </p>
      )}

      {!coin ? (
        <Panel title="Scalping is starting">
          <p className="text-sm text-ink-muted">
            The first 1-minute scan runs within a minute of the server starting. This page fills in
            by itself.
          </p>
        </Panel>
      ) : (
        <>
          <nav aria-label="Coin" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {quick.map((s) => (
              <Chip key={s} href={href({ s })} active={s === coin.symbol}>
                {coinName(s)}
                {mine.has(s) && <span className="text-xs text-coach">●</span>}
              </Chip>
            ))}
          </nav>

          <section
            aria-label={`${coinName(coin.symbol)} on every timeframe`}
            className="surface grid grid-cols-[minmax(0,1fr)] gap-4 rounded-[var(--radius-surface)] p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">
                  {coinName(coin.symbol)}{" "}
                  <span className="figures text-base font-normal text-ink-muted">
                    {formatPrice(coin.price)}
                  </span>
                </h2>
                <Alignment coin={coin} />
              </div>
              <dl className="figures flex flex-wrap gap-4 text-sm">
                <div>
                  <dt className="text-xs text-ink-faint">Today's VWAP</dt>
                  <dd>{coin.vwap ? formatPrice(coin.vwap) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-faint">Price vs VWAP</dt>
                  <dd
                    className={cn(
                      "font-semibold",
                      (coin.vwapDistPct ?? 0) > 0
                        ? "text-profit"
                        : (coin.vwapDistPct ?? 0) < 0
                          ? "text-loss"
                          : "",
                    )}
                  >
                    {coin.vwapDistPct === null
                      ? "—"
                      : `${pct(coin.vwapDistPct)} ${coin.vwapDistPct >= 0 ? "above" : "below"}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-faint">Funding (next)</dt>
                  <dd>{coin.funding === null ? "—" : `${(coin.funding * 100).toFixed(4)}%`}</dd>
                </div>
              </dl>
            </div>
            <MetalNote symbol={coin.symbol} />
            <TimeframeStrip coin={coin} />
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[var(--radius-control)] border border-rule p-4">
                <h3 className="mb-3 text-sm font-semibold">Volatility</h3>
                <VolatilityCard coin={coin} />
              </div>
              <div className="rounded-[var(--radius-control)] border border-rule p-4">
                <h3 className="mb-3 text-sm font-semibold">Key levels</h3>
                <LevelsCard coin={coin} />
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="rounded-[var(--radius-control)] border border-rule p-4">
                <h3 className="mb-3 text-sm font-semibold">Order book near price</h3>
                {coin.book ? (
                  <BookPressure book={coin.book} />
                ) : (
                  <p className="text-sm text-ink-muted">
                    Order books are read for the {SCALP_BOOK_COINS} most traded coins.
                  </p>
                )}
              </div>
              <div className="grid content-start gap-2 rounded-[var(--radius-control)] border border-rule p-4 text-sm">
                <h3 className="font-semibold">Open in</h3>
                <p className="flex flex-wrap gap-x-4 gap-y-1">
                  <Link
                    href={`/cockpit?s=${coin.symbol}`}
                    className="font-semibold text-coach underline-offset-4 hover:underline"
                  >
                    Scalp Cockpit
                  </Link>
                  <Link
                    href={`/live?s=${coin.symbol}`}
                    className="text-coach underline-offset-4 hover:underline"
                  >
                    Live chart
                  </Link>
                  <Link
                    href={`/orderflow?w=5m&c=${coin.symbol}#coin`}
                    className="text-coach underline-offset-4 hover:underline"
                  >
                    Order Flow (5m)
                  </Link>
                  {(DESK_SYMBOLS as readonly string[]).includes(coin.symbol) && (
                    <Link
                      href={`/check?s=${coin.symbol}`}
                      className="text-coach underline-offset-4 hover:underline"
                    >
                      Trade Check
                    </Link>
                  )}
                  <Link
                    href="/calculators"
                    className="text-coach underline-offset-4 hover:underline"
                  >
                    Position size calculator
                  </Link>
                </p>
                <p className="text-xs text-ink-faint">
                  Strength shows how one-sided market orders were in each period; it changes quickly
                  on 5m and 15m. Pair it with your own levels and a stop.
                </p>
              </div>
            </div>
          </section>

          {data.hidden > 0 && (
            <p className="rounded-[var(--radius-control)] border border-coach/40 bg-coach/10 px-4 py-2 text-sm">
              Your plan shows the top {data.limit} coins by volume, plus gold and silver.{" "}
              <Link href="/billing" className="text-coach underline-offset-4 hover:underline">
                See all {data.coins.length + data.hidden} on Pro
              </Link>
            </p>
          )}

          <Panel
            title="Every coin, every timeframe"
            action={
              <nav aria-label="Filter" className="flex flex-wrap gap-2">
                {SCALP_FILTERS.filter((f) => f.id !== "mine" || mine.size > 0).map((f) => (
                  <Chip key={f.id} href={href({ f: f.id })} active={f.id === filter}>
                    {f.label}
                  </Chip>
                ))}
              </nav>
            }
          >
            {rows.length === 0 ? (
              <p className="text-sm text-ink-muted">No coin matches this filter right now.</p>
            ) : (
              <StrengthGrid
                coins={rows}
                href={(s) => href({ s })}
                selected={coin.symbol}
                mine={mine}
              />
            )}
          </Panel>

          <details className="surface rounded-[var(--radius-surface)] p-5 text-sm text-ink-muted">
            <summary className="cursor-pointer font-semibold text-ink">
              How to read this page
            </summary>
            <div className="mt-3 grid gap-3">
              <p>
                <strong className="text-ink">Strength</strong> is buy pressure: market buys minus
                market sells as a share of all trading in the period. The bands are wider for short
                periods, because a few minutes swing more than a day:
              </p>
              <div className="overflow-x-auto">
                <table className="figures min-w-[30rem] text-xs">
                  <thead>
                    <tr className="text-ink-faint">
                      <th scope="col" className="pr-4 text-left font-medium">
                        Period
                      </th>
                      <th scope="col" className="pr-4 text-left font-medium">
                        Buying / Selling
                      </th>
                      <th scope="col" className="text-left font-medium">
                        Strong
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ORDERFLOW_WINDOWS.map((w) => (
                      <tr key={w}>
                        <td className="pr-4">{ORDERFLOW_WINDOW_LABEL[w]}</td>
                        <td className="pr-4">±{STRENGTH_THRESHOLDS[w].lean}% or more</td>
                        <td>±{STRENGTH_THRESHOLDS[w].strong}% or more</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                <strong className="text-ink">Volume</strong> compares trading in the period with the
                usual pace (the last 4 hours for 5m–1H, the last day for 4H); {UNUSUAL_VOLUME}× or
                more is flagged as unusual.
              </p>
              <p>
                <strong className="text-ink">VWAP</strong> is today's average traded price weighted
                by volume, since 00:00 UTC. <strong className="text-ink">Order book</strong> adds up
                the buy and sell orders resting within each distance of the price; the number is
                (bids − asks) ÷ both. Walls are single levels at least 5× the usual size. Orders can
                be pulled at any moment, so the book is a snapshot, not a promise.
              </p>
            </div>
          </details>
        </>
      )}
    </>
  );
}
