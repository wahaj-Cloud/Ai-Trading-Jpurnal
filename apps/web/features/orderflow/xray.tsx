"use client";

import {
  type AcrossCell,
  CARD_CANDLES,
  type CandleRow,
  flowAgreement,
  type MapCoin,
  moveRank,
  ORDERFLOW_WINDOW_LABEL,
  type OrderflowCoinDto,
  type OrderflowWindow,
  REGIME_INFO,
} from "@atc/shared";
import { type Candle, sessionVwap } from "@atc/ta/indicators";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  LineSeries,
  LineStyle,
  type Time,
} from "lightweight-charts";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BlockedError, fetchCandles } from "@/features/live/binance";
import { toTaCandles } from "@/features/live/chart/studies";
import { chartZones, sdChartZones, ZonesPrimitive } from "@/features/live/chart/zones";
import { formatPrice } from "@/features/live/market";
import { useThemeKey } from "@/features/theme/use-theme-key";
import { cn } from "@/lib/cn";
import { getCoinCandlesAction } from "./actions";
import { coinName, pct, usd } from "./format";
import { readColors } from "./gates";
import { REGIME_TONE } from "./views";
import { type Box, xrayFacts } from "./xray-facts";

type Load =
  | { state: "loading" }
  | { state: "blocked" | "error" }
  | {
      state: "ready";
      c15: Candle[];
      h1: Candle[];
      h4: Candle[];
    };

const closed = (rows: Awaited<ReturnType<typeof fetchCandles>>) =>
  toTaCandles(rows.filter((r) => r.closeTime < Date.now()));
const fromRows = (rows: readonly CandleRow[]): Candle[] =>
  rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));

/**
 * The card's candles: from our API first (shared cache, works in every region), else straight from
 * Binance in the browser.
 */
async function loadCardCandles(
  symbol: string,
  signal: AbortSignal,
): Promise<{ c15: Candle[]; h1: Candle[]; h4: Candle[] }> {
  const ours = await getCoinCandlesAction(symbol).catch(() => null);
  if (ours)
    return {
      c15: fromRows(ours.candles["15m"]),
      h1: fromRows(ours.candles["1h"]),
      h4: fromRows(ours.candles["4h"]),
    };
  const [a, b, c] = await Promise.all([
    fetchCandles(symbol, "15m", CARD_CANDLES["15m"], signal),
    fetchCandles(symbol, "1h", CARD_CANDLES["1h"], signal),
    fetchCandles(symbol, "4h", CARD_CANDLES["4h"], signal),
  ]);
  return { c15: closed(a), h1: closed(b), h4: closed(c) };
}

function Row({ k, children, tone }: { k: string; children: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule/50 py-1.5 last:border-0">
      <dt className="text-[11px] tracking-wide text-ink-faint uppercase">{k}</dt>
      <dd className={cn("figures text-right text-sm", tone)}>{children}</dd>
    </div>
  );
}

const range = (b: Box | null) =>
  b ? `${formatPrice(b.bottom)}–${formatPrice(b.top)}` : "none nearby";
const dist = (b: Box | null) => (b ? (b.distPct === 0 ? "price inside" : pct(b.distPct)) : "");

/**
 * A coin's card, Order-Block style: rank of its move, positioning, VWAP and flow, the nearest 15m
 * order blocks and 1H/4H supply and demand zones with how far they are, today's and yesterday's
 * range, and a 15-minute chart with those boxes drawn. Candles come through our API (shared cache)
 * or, failing that, straight from Binance; nothing here is a call to trade.
 */
export function CoinXray({
  coin,
  coins,
  cells,
  window,
  held,
  closeHref,
}: {
  coin: OrderflowCoinDto;
  coins: MapCoin[];
  cells: Partial<Record<OrderflowWindow, AcrossCell>>;
  window: OrderflowWindow;
  held: boolean;
  closeHref: string;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const rank = useMemo(() => moveRank(coins, coin.symbol), [coins, coin.symbol]);
  const agree = flowAgreement(cells, window);
  const symbol = coin.symbol;

  useEffect(() => {
    const ctrl = new AbortController();
    setLoad({ state: "loading" });
    loadCardCandles(symbol, ctrl.signal)
      .then((sets) => {
        if (!ctrl.signal.aborted) setLoad({ state: "ready", ...sets });
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setLoad({ state: err instanceof BlockedError ? "blocked" : "error" });
      });
    return () => ctrl.abort();
  }, [symbol]);

  // Distances from the live price the rest of the page shows (recounted as it moves).
  const price = coin.price;
  const f = useMemo(
    () =>
      load.state === "ready" ? xrayFacts(load.c15, { "1h": load.h1, "4h": load.h4 }, price) : null,
    [load, price],
  );
  const info = REGIME_INFO[coin.regime];
  return (
    <section
      id="coin"
      aria-label={`${coinName(coin.symbol)} card`}
      className="surface hud grid scroll-mt-24 gap-4 rounded-[var(--radius-surface)] p-4 ring-1 ring-coach/40 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-coach uppercase">
            Coin card · last {ORDERFLOW_WINDOW_LABEL[window]}
          </p>
          <h2 className="mt-1 flex flex-wrap items-baseline gap-x-3 text-2xl font-semibold">
            {coinName(coin.symbol)}
            <span className="figures text-lg font-normal">{formatPrice(coin.price)}</span>
            <span
              className={cn(
                "figures text-base",
                coin.priceChangePct >= 0 ? "text-profit" : "text-loss",
              )}
            >
              {pct(coin.priceChangePct)}
            </span>
            {held && <span className="text-sm text-coach">● you hold this</span>}
          </h2>
        </div>
        <Link href={closeHref} scroll={false} className="text-sm text-ink-muted hover:text-ink">
          Close ✕
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <dl className="grid content-start gap-x-6 sm:grid-cols-2 lg:grid-cols-1">
          <Row k="Move rank">
            {rank
              ? `#${rank.rank} of ${rank.of} · ${rank.percentile >= 50 ? `top ${Math.max(1, Math.round(100 - rank.percentile))}%` : `bottom ${Math.max(1, Math.round(rank.percentile))}%`}`
              : "—"}
          </Row>
          <Row k="Open interest" tone={REGIME_TONE[coin.regime]}>
            {coin.oiChangePct === null ? "—" : pct(coin.oiChangePct, 1)} · {info.label}
          </Row>
          <Row k="Net flow" tone={coin.netFlowUsd >= 0 ? "text-profit" : "text-loss"}>
            {usd(coin.netFlowUsd)} · {pct(coin.buyPressurePct, 0)} pressure
          </Row>
          <Row
            k="VWAP (UTC day)"
            tone={
              f?.vwapDistPct == null ? undefined : f.vwapDistPct >= 0 ? "text-profit" : "text-loss"
            }
          >
            {f?.vwap && f.vwapDistPct !== null
              ? `${formatPrice(f.vwap)} · price ${f.vwapDistPct >= 0 ? "above" : "below"} by ${Math.abs(f.vwapDistPct).toFixed(2)}%`
              : "—"}
          </Row>
          <Row k="Timeframes agreeing">
            {agree.side ? `${agree.same} of ${agree.of} lean to ${agree.side}` : "no lean"}
          </Row>
          <Row k="Activity">
            {coin.relVolume === null ? "—" : `${coin.relVolume.toFixed(1)}× usual`}
          </Row>
          <Row k="Supply above" tone="text-loss">
            {f ? (
              <>
                {range(f.supply)}{" "}
                <span className="text-xs text-ink-faint">
                  {f.supply
                    ? `${f.supply.label}${f.supply.fresh ? " · fresh" : ""} · ${dist(f.supply)}`
                    : ""}
                </span>
              </>
            ) : (
              "…"
            )}
          </Row>
          <Row k="Demand below" tone="text-profit">
            {f ? (
              <>
                {range(f.demand)}{" "}
                <span className="text-xs text-ink-faint">
                  {f.demand
                    ? `${f.demand.label}${f.demand.fresh ? " · fresh" : ""} · ${dist(f.demand)}`
                    : ""}
                </span>
              </>
            ) : (
              "…"
            )}
          </Row>
          <Row k="Order block above">{f ? `${range(f.obAbove)} ${dist(f.obAbove)}` : "…"}</Row>
          <Row k="Order block below">{f ? `${range(f.obBelow)} ${dist(f.obBelow)}` : "…"}</Row>
          <Row k="Today high / low">
            {f?.dayHigh ? `${formatPrice(f.dayHigh)} / ${formatPrice(f.dayLow ?? 0)}` : "…"}
          </Row>
          <Row k="Yesterday high / low">
            {f?.prevHigh ? `${formatPrice(f.prevHigh)} / ${formatPrice(f.prevLow ?? 0)}` : "…"}
          </Row>
        </dl>
        <div className="min-w-0">
          {load.state === "ready" ? (
            <MiniChart
              c15={load.c15}
              h1={load.h1}
              h4={load.h4}
              dayHigh={f?.dayHigh ?? null}
              dayLow={f?.dayLow ?? null}
              blocks={[f?.obAbove, f?.obBelow, f?.supply, f?.demand].flatMap((b) =>
                b ? [`${b.bottom}:${b.top}`] : [],
              )}
            />
          ) : (
            <div className="grid h-72 place-items-center rounded-[var(--radius-control)] bg-hi/[0.03] text-sm text-ink-muted">
              {load.state === "loading"
                ? "Loading candles…"
                : load.state === "blocked"
                  ? "Candles are not reachable right now: the figures on the left are from our scan."
                  : "Could not load candles right now."}
            </div>
          )}
          <p className="mt-2 text-[11px] text-ink-faint">
            15-minute candles. Boxes: order blocks (15m) and the nearest 1H/4H supply (red) and
            demand (green) zones; dotted line: today&apos;s VWAP. Where price reacted before, not a
            forecast.
          </p>
        </div>
      </div>
    </section>
  );
}

function MiniChart({
  c15,
  h1,
  h4,
  dayHigh,
  dayLow,
  blocks,
}: {
  c15: Candle[];
  h1: Candle[];
  h4: Candle[];
  dayHigh: number | null;
  dayLow: number | null;
  /**
   * The boxes the card lists ("bottom:top"): nearest order blocks either side and the nearest
   * supply above and demand below; the only ones drawn, so the chart matches the figures.
   */
  blocks: string[];
}) {
  const blockKey = blocks.join("|");
  const el = useRef<HTMLDivElement>(null);
  const themeKey = useThemeKey();
  // biome-ignore lint/correctness/useExhaustiveDependencies: redrawn when the theme (colours) changes
  useEffect(() => {
    const host = el.current;
    if (!host) return;
    const col = readColors(host);
    const chart: IChartApi = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: col.faint,
        fontSize: 10,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(128,128,160,0.12)" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, rightOffset: 4 },
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: col.up,
      downColor: col.down,
      wickUpColor: col.up,
      wickDownColor: col.down,
      borderVisible: false,
    });
    const shown = c15.slice(-96);
    series.setData(
      shown.map((c) => ({
        time: (c.t / 1000) as Time,
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
      })),
    );
    const first = (shown[0]?.t ?? 0) / 1000;
    const zones = new ZonesPrimitive(({ t, p }) => {
      const y = series.priceToCoordinate(p);
      const x = chart.timeScale().timeToCoordinate(t as Time) ?? (t < first ? 0 : null);
      return x === null || y === null ? null : { x, y };
    });
    series.attachPrimitive(zones);
    const price = shown.at(-1)?.c ?? 0;
    const keep = new Set(blockKey.split("|"));
    const sd = [...sdChartZones(h1, price, "1h"), ...sdChartZones(h4, price, "4h")].filter((z) =>
      keep.has(`${z.bottom}:${z.top}`),
    );
    const obs = chartZones(c15, { fvg: false, ob: true }).filter(
      (z) => z.kind === "OB" && keep.has(`${z.bottom}:${z.top}`),
    );
    zones.set([...obs, ...sd], { up: col.up, down: col.down });
    // Today's VWAP (restarts at 00:00 UTC), the same calculation as the card's figure.
    const vw = sessionVwap(c15).slice(-shown.length);
    const vwLine = chart.addSeries(LineSeries, {
      color: col.accent,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    vwLine.setData(shown.map((c, i) => ({ time: (c.t / 1000) as Time, value: vw[i] as number })));
    for (const [p, title] of [
      [dayHigh, "Day high"],
      [dayLow, "Day low"],
    ] as const)
      if (p)
        series.createPriceLine({
          price: p,
          color: col.faint,
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          title,
          axisLabelVisible: false,
        });
    chart.timeScale().fitContent();
    return () => {
      series.detachPrimitive(zones);
      chart.remove();
    };
  }, [c15, h1, h4, dayHigh, dayLow, blockKey, themeKey]);
  return <div ref={el} className="h-72 w-full" />;
}
