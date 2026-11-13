"use client";

import {
  breadthOf,
  type CardZones,
  nearestCardZone,
  type OrderflowCoinDto,
  type OrderflowWindow,
  REGIME_INFO,
  replayCoins,
  riverPath,
  type Sector,
  sectorOf,
  sectorRows,
  seriesPointTime,
  ZONE_TF_LABEL,
} from "@atc/shared";
import { Pause, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { coinName, pct } from "./format";
import { MarketRiver } from "./river";
import { REGIME_TONE } from "./views";

/** A row of small blocks: one per coin in the sector, green for up, red for down. */
function BreadthBar({ up, down, flat }: { up: number; down: number; flat: number }) {
  const total = Math.max(1, up + down + flat);
  return (
    <span
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-hi/10"
      title={`${up} up · ${down} down${flat ? ` · ${flat} flat` : ""}`}
    >
      <span className="bg-profit" style={{ width: `${(up / total) * 100}%` }} />
      <span className="bg-hi/20" style={{ width: `${(flat / total) * 100}%` }} />
      <span className="bg-loss" style={{ width: `${(down / total) * 100}%` }} />
    </span>
  );
}

/** Sector strength: average move, how many coins are up and down, and the biggest mover. */
function Sectors({
  coins,
  highlight,
  onHighlight,
}: {
  coins: OrderflowCoinDto[];
  highlight: Sector | null;
  onHighlight: (s: Sector | null) => void;
}) {
  const rows = useMemo(() => sectorRows(coins), [coins]);
  return (
    <ul className="grid content-start gap-1.5" aria-label="Sectors">
      {rows.map((r) => (
        <li key={r.sector}>
          <button
            type="button"
            aria-pressed={highlight === r.sector}
            onClick={() => onHighlight(highlight === r.sector ? null : r.sector)}
            className={cn(
              "grid w-full gap-1 rounded-[var(--radius-control)] px-2.5 py-1.5 text-left transition-colors",
              highlight === r.sector ? "bg-coach/15 ring-1 ring-coach/50" : "hover:bg-hi/[0.05]",
            )}
          >
            <span className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold tracking-wide uppercase">{r.label}</span>
              <span className={cn("figures", r.avgPct >= 0 ? "text-profit" : "text-loss")}>
                {pct(r.avgPct)}
              </span>
            </span>
            <BreadthBar up={r.up} down={r.down} flat={r.flat} />
            <span className="figures flex justify-between text-[10px] text-ink-faint">
              <span>
                {r.count} coin{r.count === 1 ? "" : "s"} · {r.up} up · {r.down} down
              </span>
              {r.leader && (
                <span>
                  {coinName(r.leader.symbol)} {pct(r.leader.pct, 1)}
                </span>
              )}
            </span>
          </button>
        </li>
      ))}
      {highlight && (
        <li className="px-2.5 text-[11px] text-ink-faint">
          Showing {rows.find((r) => r.sector === highlight)?.label} in front.{" "}
          <button type="button" className="text-coach" onClick={() => onHighlight(null)}>
            Show all
          </button>
        </li>
      )}
    </ul>
  );
}

/**
 * The nearer of the coin's 1H/4H supply above and demand below, from the live price: "4H supply
 * +0.8%", or "in 1H demand" when price sits inside it.
 */
function ZoneChip({ zones, price }: { zones: CardZones | undefined; price: number }) {
  const z = nearestCardZone(zones, price);
  if (!z) return <span className="text-ink-faint">no zone near</span>;
  const name = `${ZONE_TF_LABEL[z.tf]} ${z.side}${z.fresh ? " · fresh" : ""}`;
  return (
    <span
      className={z.side === "supply" ? "text-loss" : "text-profit"}
      title={`Nearest 1H/4H zone: ${name}, ${z.bottom}–${z.top}. Where price reacted before, not a forecast.`}
    >
      {z.distPct === 0 ? `in ${name}` : `${name} ${pct(z.distPct, 1)}`}
    </span>
  );
}

/** One coin's card in the grid: move, positioning pattern, buy pressure bar, open interest, zone. */
function Card({
  c,
  href,
  held,
  faded,
  zones,
}: {
  c: OrderflowCoinDto;
  href: string;
  held: boolean;
  faded: boolean;
  zones: CardZones | undefined;
}) {
  const bp = Math.max(-100, Math.min(100, c.buyPressurePct));
  return (
    <Link
      href={href}
      scroll={false}
      className={cn(
        "grid gap-1 rounded-[var(--radius-control)] border px-2.5 py-2 text-xs transition-all hover:-translate-y-0.5",
        c.priceChangePct >= 0
          ? "border-profit/25 bg-profit/[0.06] hover:border-profit/60"
          : "border-loss/25 bg-loss/[0.06] hover:border-loss/60",
        held && "ring-1 ring-coach",
        faded && "opacity-30",
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate font-semibold">{coinName(c.symbol)}</span>
        <span className={cn("figures", c.priceChangePct >= 0 ? "text-profit" : "text-loss")}>
          {pct(c.priceChangePct)}
        </span>
      </span>
      <span className={cn("truncate text-[10px] font-semibold uppercase", REGIME_TONE[c.regime])}>
        {REGIME_INFO[c.regime].label}
      </span>
      <span
        className="relative h-1 rounded-full bg-hi/10"
        title={`Buy pressure ${pct(c.buyPressurePct, 1)}`}
      >
        <span className="absolute top-0 left-1/2 h-1 w-px bg-ink-faint" />
        <span
          className={cn("absolute top-0 h-1 rounded-full", bp >= 0 ? "bg-profit" : "bg-loss")}
          style={
            bp >= 0 ? { left: "50%", width: `${bp / 2}%` } : { right: "50%", width: `${-bp / 2}%` }
          }
        />
      </span>
      <span className="figures flex justify-between text-[10px] text-ink-faint">
        <span>flow {pct(c.buyPressurePct, 0)}</span>
        <span>OI {c.oiChangePct === null ? "—" : pct(c.oiChangePct, 1)}</span>
      </span>
      <span className="figures truncate text-[10px]">
        <ZoneChip zones={zones} price={c.price} />
      </span>
    </Link>
  );
}

const SHOW = 24;
/** Replay speed: one point of the path per tick. */
const PLAY_MS = 140;

const clock = (ms: number, timeZone: string) => {
  try {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    });
  } catch {
    return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
};

/**
 * Scrub back through the window: a slider over the river's points, play from the window start, and
 * "Live" to return. The time shown is when that point's candle closed (the trader's time zone).
 */
function ReplayBar({
  at,
  len,
  label,
  playing,
  onAt,
  onPlay,
}: {
  at: number | null;
  len: number;
  label: string;
  playing: boolean;
  onAt: (i: number | null) => void;
  onPlay: (on: boolean) => void;
}) {
  const value = at ?? len - 1;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-rule/60 pt-3">
      <button
        type="button"
        onClick={() => onPlay(!playing)}
        aria-label={playing ? "Pause replay" : "Play the window from its start"}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-coach/50 text-coach hover:bg-coach/15"
      >
        {playing ? (
          <Pause className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Play className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
      <label className="flex min-w-0 flex-1 items-center gap-3 text-xs text-ink-faint">
        <span className="sr-only">Replay point</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, len - 1)}
          step={1}
          value={value}
          aria-valuetext={at === null ? "now" : label}
          onChange={(e) => {
            const i = Number(e.target.value);
            onPlay(false);
            onAt(i >= len - 1 ? null : i);
          }}
          className="h-1.5 min-w-32 flex-1 cursor-pointer accent-[var(--color-coach)]"
        />
        <span className="figures w-24 shrink-0 text-right text-ink">
          {at === null ? "now" : label}
        </span>
      </label>
      <button
        type="button"
        disabled={at === null}
        onClick={() => {
          onPlay(false);
          onAt(null);
        }}
        className="rounded-full border border-rule px-3 py-1 text-xs hover:bg-hi/[0.06] disabled:opacity-40"
      >
        Live
      </button>
    </div>
  );
}

/**
 * The market map (Order Flow's opening view): sectors on the left, the river of every coin's move
 * in the middle (with a replay slider), and below it every coin as a card, risers above the zero
 * line and fallers below, each with its positioning pattern, buy pressure and nearest zone.
 * Replaying moves the river, counts, sectors and card order to that moment; flow and open interest
 * on the cards stay current.
 */
export function MarketMap({
  coins,
  window,
  label,
  asOf,
  zones,
  timeZone,
  coinHref,
  selected,
  mine,
}: {
  coins: OrderflowCoinDto[];
  window: OrderflowWindow;
  label: string;
  /** Close of the candle the scan runs to (ISO), to time the replay points. */
  asOf: string | null;
  zones: Record<string, CardZones>;
  timeZone: string;
  coinHref: (symbol: string) => string;
  selected: string | null;
  mine: Set<string>;
}) {
  const [highlight, setHighlight] = useState<Sector | null>(null);
  const [all, setAll] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  // Every coin's path ending at its live move; paths line up at their right end (now).
  const withPaths = useMemo(
    () => coins.map((c) => ({ ...c, path: riverPath(c.series.price, c.priceChangePct) })),
    [coins],
  );
  const len = Math.max(1, ...withPaths.map((c) => c.path.length));
  const seriesLen = Math.max(1, ...coins.map((c) => c.series.price.length));
  // A new window or a shorter scan cannot leave the replay point past the end.
  const point = at !== null && at < len - 1 ? at : null;
  const shown = useMemo(
    () => (point === null ? withPaths : replayCoins(withPaths, len - 1 - point)),
    [withPaths, point, len],
  );

  const pointLabel = useMemo(() => {
    if (point === null || !asOf) return "now";
    const asOfMs = Date.parse(asOf);
    // Points past the scanned series are the live move (now).
    if (len > seriesLen && point >= seriesLen) return "now";
    return clock(seriesPointTime(window, asOfMs, point, seriesLen), timeZone);
  }, [point, asOf, len, seriesLen, window, timeZone]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setAt((cur) => {
        const next = cur === null ? 0 : cur + 1;
        if (next >= len - 1) {
          setPlaying(false);
          return null;
        }
        return next;
      });
    }, PLAY_MS);
    return () => clearInterval(id);
  }, [playing, len]);

  const breadth = useMemo(() => breadthOf(shown), [shown]);
  const river = useMemo(
    () =>
      withPaths.map((c) => ({
        symbol: c.symbol,
        rank: c.rank,
        volumeUsd: c.volumeUsd,
        priceChangePct: shown.find((x) => x.symbol === c.symbol)?.priceChangePct ?? 0,
        path: c.path,
      })),
    [withPaths, shown],
  );
  const ups = shown
    .filter((c) => c.priceChangePct >= 0)
    .sort((a, b) => b.priceChangePct - a.priceChangePct);
  const downs = shown
    .filter((c) => c.priceChangePct < 0)
    .sort((a, b) => a.priceChangePct - b.priceChangePct);
  const faded = (c: OrderflowCoinDto) => highlight !== null && sectorOf(c.symbol) !== highlight;
  const grid = (list: OrderflowCoinDto[]) => (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
      {(all ? list : list.slice(0, SHOW)).map((c) => (
        <Card
          key={c.symbol}
          c={c}
          href={coinHref(c.symbol)}
          held={mine.has(c.symbol)}
          faded={faded(c)}
          zones={zones[c.symbol]}
        />
      ))}
    </div>
  );

  const quick = ["XAUUSDT", "XAGUSDT", "BTCUSDT", "ETHUSDT"].filter((s) =>
    coins.some((c) => c.symbol === s),
  );
  const replaying = point !== null;
  return (
    <div className="grid gap-4">
      {quick.length > 0 && (
        <nav aria-label="Coin cards" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-ink-faint">Open a card:</span>
          {quick.map((s) => (
            <Link
              key={s}
              href={coinHref(s)}
              scroll={false}
              className={cn(
                "rounded-full border px-3 py-1",
                s === selected
                  ? "border-coach/60 bg-coach/15"
                  : "border-rule text-ink-muted hover:bg-hi/[0.06] hover:text-ink",
              )}
            >
              {coinName(s)}
            </Link>
          ))}
        </nav>
      )}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="surface order-2 rounded-[var(--radius-surface)] p-3 max-lg:max-h-[22rem] max-lg:overflow-y-auto lg:order-1 lg:max-h-[33rem] lg:overflow-y-auto">
          <p className="mb-2 px-2.5 text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
            Sectors · {replaying ? `at ${pointLabel}` : label}
          </p>
          <Sectors coins={shown} highlight={highlight} onHighlight={setHighlight} />
        </div>
        <div className="surface hud order-1 grid min-w-0 gap-3 rounded-[var(--radius-surface)] p-4 lg:order-2">
          <MarketRiver
            coins={river}
            breadth={breadth}
            window={label}
            coinHref={coinHref}
            selected={selected}
            highlight={highlight}
            at={point}
            atLabel={pointLabel}
          />
          {len > 2 && (
            <ReplayBar
              at={point}
              len={len}
              label={pointLabel}
              playing={playing}
              onAt={setAt}
              onPlay={setPlaying}
            />
          )}
        </div>
      </div>
      <div className="surface grid gap-3 rounded-[var(--radius-surface)] p-4">
        {replaying && (
          <p className="rounded-[var(--radius-control)] border border-coach/40 bg-coach/10 px-3 py-2 text-xs text-ink-muted">
            Replaying: moves and order as at {pointLabel}. Flow, open interest and zones on the
            cards are as of now.{" "}
            <button type="button" className="text-coach" onClick={() => setAt(null)}>
              Back to live
            </button>
          </p>
        )}
        <p className="flex items-center justify-between text-[11px] font-semibold tracking-[0.14em] text-profit uppercase">
          <span>Up · {ups.length}</span>
          <span className="font-normal tracking-normal text-ink-faint normal-case">
            Biggest rise first · {window === "24h" ? "1 day" : label}
          </span>
        </p>
        {ups.length ? grid(ups) : <p className="text-sm text-ink-muted">No coin is up.</p>}
        <div className="relative my-1 h-px bg-coach/60">
          <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-[var(--color-sheet)] px-2 text-[10px] text-coach">
            0%
          </span>
        </div>
        <p className="text-[11px] font-semibold tracking-[0.14em] text-loss uppercase">
          Down · {downs.length}
        </p>
        {downs.length ? grid(downs) : <p className="text-sm text-ink-muted">No coin is down.</p>}
        {(ups.length > SHOW || downs.length > SHOW) && (
          <button
            type="button"
            onClick={() => setAll(!all)}
            className="justify-self-start rounded-full border border-rule px-3 py-1 text-xs hover:bg-hi/[0.06]"
          >
            {all ? `Show the top ${SHOW} each side` : `Show all ${coins.length}`}
          </button>
        )}
      </div>
    </div>
  );
}
