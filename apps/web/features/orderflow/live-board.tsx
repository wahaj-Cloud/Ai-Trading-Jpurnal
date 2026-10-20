"use client";

import {
  applyLiveToAcross,
  applyLiveToOrderflowCoin,
  coinRead,
  isLiveWindow,
  marketRead,
  ORDERFLOW_WINDOW_LABEL,
  type OrderflowResponse,
  type OrderflowWindow,
  REGIME_INFO,
  REGIMES,
} from "@atc/shared";
import Link from "next/link";
import { type ReactNode, useMemo } from "react";
import { FreshnessBadge } from "@/features/live-flow/freshness";
import { useLiveView } from "@/features/live-flow/use-live-view";
import { cn } from "@/lib/cn";
import { type GateCoin, OrderflowGates } from "./gates";
import { type MatrixFilter, orderflowHref } from "./href";
import {
  FlowMatrix,
  Glossary,
  MarketReadPanel,
  PatternCards,
  SectionHead,
  StandOuts,
} from "./insights";
import {
  CoinDetail,
  CoinsTable,
  PositioningMap,
  REGIME_TONE,
  TABLE_SORTS,
  type TableSort,
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
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/**
 * Everything below the Order Flow header. The server sends the latest minute figures; on 5m to 1H
 * the live stream then replaces them every second (buying and selling, price, open interest every
 * 5 s, funding), and every panel, read and table is worked out again from the live numbers.
 */
export function OrderflowBoard({
  initial,
  window,
  sort,
  mx,
  selectedSymbol,
}: {
  initial: OrderflowResponse;
  window: OrderflowWindow;
  sort: TableSort;
  mx: MatrixFilter;
  selectedSymbol: string | null;
}) {
  const live = useLiveView({ view: "orderflow", w: window, enabled: initial.coins.length > 0 });
  const lv = live.data;
  const liveWindow = isLiveWindow(window);
  const data = useMemo<OrderflowResponse>(() => {
    if (!lv) return initial;
    const by = new Map(lv.coins.map((c) => [c.s, c]));
    const coins = initial.coins.map((c) => {
      const l = by.get(c.symbol);
      return l ? applyLiveToOrderflowCoin(c, l, window) : c;
    });
    return {
      ...initial,
      coins,
      across: applyLiveToAcross(initial.across ?? {}, lv.coins),
      ...(liveWindow && lv.summary
        ? {
            buying: lv.summary.buying,
            selling: lv.summary.selling,
            netFlowUsd: lv.summary.netFlowUsd,
            counts: lv.summary.counts,
          }
        : {}),
    };
  }, [initial, lv, window, liveWindow]);

  const label = ORDERFLOW_WINDOW_LABEL[window];
  const mine = useMemo(() => new Set(data.mine), [data.mine]);
  const base = (patch: Record<string, string | undefined> = {}) =>
    orderflowHref({ window, sort, mx }, patch);
  const coinHref = (symbol: string) => `${base({ c: symbol })}#coin`;
  const selected = data.coins.find((c) => c.symbol === selectedSymbol);
  const gateCoins: GateCoin[] = useMemo(
    () =>
      data.coins.map((c) => ({
        symbol: c.symbol,
        rank: c.rank,
        volumeUsd: c.volumeUsd,
        netFlowUsd: c.netFlowUsd,
        buyPressurePct: c.buyPressurePct,
        priceChangePct: c.priceChangePct,
        regime: c.regime,
        strength: c.strength,
        pressure: c.series.pressure,
      })),
    [data.coins],
  );
  const read = marketRead({
    window,
    coins: data.coins,
    buying: data.buying,
    selling: data.selling,
    netFlowUsd: data.netFlowUsd,
  });
  const showLive = liveWindow && live.status === "live" && lv !== null;
  const stale =
    !showLive && data.computedAt && Date.now() - Date.parse(data.computedAt) > 20 * 60_000;
  const across = data.across ?? {};

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-faint">
        <FreshnessBadge
          at={showLive ? (lv?.at ?? null) : (data.computedAt ?? null)}
          live={showLive}
          every={liveWindow ? "every minute" : "every 5 min"}
          staleAfterMs={liveWindow ? 3 * 60_000 : 20 * 60_000}
        />
        <span>
          {liveWindow
            ? showLive
              ? "Buying and selling update every second, open interest every 5 seconds."
              : live.status === "connecting"
                ? "Connecting to the live feed…"
                : "Live feed unavailable: showing the 1-minute scan."
            : `${label} figures update every 5 minutes; prices and the 5m–1H columns move live.`}
        </span>
      </div>
      {stale && (
        <p className="rounded-[var(--radius-control)] border border-[#f59e0b]/50 bg-[#f59e0b]/10 px-4 py-2 text-sm">
          These figures are from {ago(data.computedAt ?? "")}: the data feed is catching up.
        </p>
      )}

      {data.coins.length === 0 ? (
        <section className="surface rounded-[var(--radius-surface)] p-6">
          <h2 className="font-semibold">Order Flow is starting</h2>
          <p className="mt-2 text-sm text-ink-muted">
            The first scan of the top 100 futures runs within 5 minutes of the server starting. This
            page fills in by itself.
          </p>
        </section>
      ) : (
        <>
          <MarketReadPanel
            read={read}
            window={window}
            buying={data.buying}
            selling={data.selling}
            netFlowUsd={data.netFlowUsd}
          />

          {data.hidden > 0 && (
            <p className="rounded-[var(--radius-control)] border border-coach/40 bg-coach/10 px-4 py-2 text-sm">
              Your plan shows the top {data.limit} coins by volume (plus gold and silver); the
              market counts include all {data.buying + data.selling}.{" "}
              <Link href="/billing" className="text-coach underline-offset-4 hover:underline">
                See every coin on Pro
              </Link>
            </p>
          )}

          {selected && (
            <CoinDetail
              coin={selected}
              window={window}
              closeHref={base()}
              held={mine.has(selected.symbol)}
              read={coinRead(selected, window, across[selected.symbol])}
              cells={across[selected.symbol] ?? {}}
              windowHref={(w) =>
                `${base({ w: w === "1h" ? undefined : w, c: selected.symbol })}#coin`
              }
            />
          )}

          <section
            aria-labelledby="flow-now"
            className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
          >
            <SectionHead
              id="flow-now"
              eyebrow="1 · Live flow"
              title={`Flow through now · last ${label}`}
              tells={
                <>
                  Each line is one coin&apos;s running buy pressure. Lines drifting to the green
                  side mean market buying is building; to the red side, selling. Hover for figures,
                  click for the coin&apos;s full read.
                  {mine.size > 0 && " Coins you hold are marked in blue."}
                </>
              }
            />
            <div className="surface hud rounded-[var(--radius-surface)] p-4 sm:p-5">
              <OrderflowGates
                coins={gateCoins}
                buying={data.buying}
                selling={data.selling}
                window={label}
                asOf={data.asOf}
                mine={data.mine}
                detailHref={base()}
              />
            </div>
          </section>

          <section
            aria-labelledby="patterns"
            className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
          >
            <SectionHead
              id="patterns"
              eyebrow="2 · Positions"
              title="Who is behind the moves"
              tells="Price change and open-interest change together show whether a move comes from new money (build-ups) or from traders closing (covering, unwinding). Moves backed by new money have more fuel behind them; closing moves can run out once the closing is done."
              action={
                <p className="flex flex-wrap gap-3 text-xs text-ink-muted">
                  {REGIMES.map((r) => (
                    <span key={r} className={REGIME_TONE[r]}>
                      {REGIME_INFO[r].label} {data.counts[r]}
                    </span>
                  ))}
                </p>
              }
            />
            <PatternCards coins={data.coins} href={coinHref} mine={mine} />
          </section>

          <section
            aria-labelledby="standouts"
            className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
          >
            <SectionHead
              id="standouts"
              eyebrow="3 · Stand-outs"
              title={`What stands out · last ${label}`}
              tells="The extremes: where the hurry is strongest, where the most money moved, where trading is unusually busy, where price is ignoring the orders, and which side is crowded."
            />
            <StandOuts coins={data.coins} window={window} href={coinHref} mine={mine} />
          </section>

          <section
            aria-labelledby="matrix"
            className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
          >
            <SectionHead
              id="matrix"
              eyebrow="4 · Every timeframe"
              title="Flow across timeframes"
              tells="Each coin's buy pressure on 5m, 15m, 30m, 1H, 4H and 1D side by side. When 5m, 15m and 1H all point the same way, short-term and hourly flow agree; when they pull apart, the quick move is going against the bigger one."
            />
            <div className="surface rounded-[var(--radius-surface)] p-4 sm:p-5">
              <FlowMatrix
                coins={data.coins}
                across={across}
                window={window}
                href={coinHref}
                mine={mine}
                filter={mx}
                filterHref={(f) => `${base({ mx: f === "all" ? undefined : f })}#matrix`}
              />
            </div>
          </section>

          <section aria-labelledby="map" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
            <SectionHead
              id="map"
              eyebrow="5 · Map"
              title={`Positioning map · last ${label}`}
              tells="Every coin placed by its price change (across) and open-interest change (up). The corner a coin sits in is its pattern; the further from the centre, the stronger it is. Big bubbles are the most traded coins."
            />
            <div className="surface rounded-[var(--radius-surface)] p-4 sm:p-5">
              <PositioningMap coins={data.coins} window={window} href={coinHref} mine={mine} />
            </div>
          </section>

          <section
            aria-labelledby="every-coin"
            className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
          >
            <SectionHead
              id="every-coin"
              eyebrow="6 · Every coin"
              title="Every coin, every figure"
              tells="All the numbers in one table. Sort by what you care about; Activity is the trading pace against usual (2.5× or more is unusual), Note flags absorption."
              action={
                <nav aria-label="Sort" className="flex flex-wrap gap-2">
                  {TABLE_SORTS.map((s) => (
                    <Chip
                      key={s.id}
                      href={`${base({ sort: s.id === "volume" ? undefined : s.id })}#every-coin`}
                      active={s.id === sort}
                    >
                      {s.label}
                    </Chip>
                  ))}
                </nav>
              }
            />
            <div className="surface rounded-[var(--radius-surface)] p-4 sm:p-5">
              <CoinsTable
                coins={data.coins}
                sort={sort}
                window={window}
                href={coinHref}
                mine={mine}
              />
            </div>
          </section>

          <section
            aria-labelledby="glossary"
            className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
          >
            <SectionHead
              id="glossary"
              eyebrow="7 · Learn"
              title="What each number tells us"
              tells="What every figure on this page is, what it tells you, and where it can mislead."
            />
            <Glossary />
          </section>
        </>
      )}
    </>
  );
}
