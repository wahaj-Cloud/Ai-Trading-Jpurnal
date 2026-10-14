"use client";

import type { OpenPositionDto } from "@atc/shared";
import { Search, Star } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  type FeedStatus,
  formatChange,
  formatPrice,
  type LiveInterval,
  type MiniTicker,
  parseMiniTicker,
  symbolLabel,
  TRADFI_NAMES,
  useBinanceStream,
} from "./binance";
import { ChartWorkspace } from "./chart/workspace";
import { livePnl, positionMatch } from "./positions";

const ALL_TICKERS = ["!miniTicker@arr"];
const TOP = 100;
/** Always one tap away, whatever their volume today. */
const PINNED = ["BTCUSDT", "ETHUSDT", "XAUUSDT", "XAGUSDT", "SOLUSDT"];
const FAV_KEY = "wm-live-favs";

function readFavs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 50) : [];
  } catch {
    return [];
  }
}

const usd = (v: number) =>
  `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

const STATUS_TEXT: Record<FeedStatus | "loading" | "error", string> = {
  connecting: "Connecting…",
  loading: "Loading…",
  live: "Live",
  reconnecting: "Reconnecting…",
  blocked: "Unavailable in your region",
  error: "Unavailable",
};

/**
 * Live Markets: every USDT perpetual's price updating each second (top 100 by volume), and a live
 * chart for the selected coin with your open positions on it. Market data comes straight from
 * Binance to the browser.
 */
export function LiveMarkets({
  symbol,
  interval,
  positions,
}: {
  symbol: string;
  interval: LiveInterval;
  positions: OpenPositionDto[];
}) {
  const router = useRouter();
  const path = usePathname();
  const tickers = useRef(new Map<string, MiniTicker>());
  const [, setTick] = useState(0);
  const [query, setQuery] = useState("");
  const [favs, setFavs] = useState<string[]>([]);
  // Read after mount so the server and browser render the same first frame.
  useEffect(() => setFavs(readFavs()), []);
  const [chartStatus, setChartStatus] = useState<FeedStatus | "loading" | "error">("loading");

  // One message a second carries every coin that changed; one re-render per message.
  const listStatus = useBinanceStream(ALL_TICKERS, (d) => {
    if (!Array.isArray(d)) return;
    for (const raw of d) {
      const t = parseMiniTicker(raw);
      if (t.symbol.endsWith("USDT")) tickers.current.set(t.symbol, t);
    }
    setTick((n) => n + 1);
  });

  const go = useCallback(
    (s: string, tf: LiveInterval = interval) =>
      router.replace(`${path}?s=${s}${tf !== "15m" ? `&tf=${tf}` : ""}`, { scroll: false }),
    [router, path, interval],
  );
  const toggleFav = (s: string) => {
    const next = favs.includes(s) ? favs.filter((x) => x !== s) : [...favs, s];
    setFavs(next);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: favourites last for this visit only
    }
  };

  const all = [...tickers.current.values()];
  const top = all.sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, TOP);
  const q = query.trim().toUpperCase();
  const base = q ? all.filter((t) => t.symbol.includes(q)).slice(0, 50) : top;
  const list = [
    ...base.filter((t) => favs.includes(t.symbol)),
    ...base.filter((t) => !favs.includes(t.symbol)),
  ];
  const cur = tickers.current.get(symbol);
  const mine = positions.filter((p) => positionMatch(p, symbol) !== null);
  // Broker gold/silver (Exness XAUUSD, XAUUSDm…) is marked on the matching perpetual.
  const openSymbols = new Set(
    positions.map((p) => PINNED.find((s) => positionMatch(p, s) === "related") ?? p.symbol),
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <ChartWorkspace
        symbol={symbol}
        interval={interval}
        positions={positions}
        onInterval={(tf) => go(symbol, tf)}
        onStatus={setChartStatus}
        header={
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm text-ink-muted">
              <span
                aria-hidden="true"
                className={cn(
                  "h-2 w-2 rounded-full",
                  chartStatus === "live" ? "animate-pulse bg-profit" : "bg-ink-faint",
                )}
              />
              {STATUS_TEXT[chartStatus]} · Binance {TRADFI_NAMES[symbol] ? "TradFi " : ""}USDT
              perpetual
            </p>
            <h2 className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-2xl font-semibold">{symbolLabel(symbol)}</span>
              {cur && (
                <>
                  <span className="figures text-2xl font-semibold tabular-nums">
                    {formatPrice(cur.price)}
                  </span>
                  <span
                    className={cn(
                      "figures text-sm tabular-nums",
                      cur.change >= 0 ? "text-profit" : "text-loss",
                    )}
                  >
                    {formatChange(cur.change)} 24h
                  </span>
                </>
              )}
            </h2>
            {cur && (
              <p className="figures mt-1 text-xs text-ink-faint">
                24h high {formatPrice(cur.high24h)} · low {formatPrice(cur.low24h)} · volume $
                {compact.format(cur.quoteVolume)}
              </p>
            )}
          </div>
        }
      >
        {mine.length > 0 && (
          <ul className="grid gap-2 border-t border-hi/10 pt-3 text-sm">
            {mine.map((p) => {
              const exact = positionMatch(p, symbol) === "exact";
              const pnl = cur && exact ? livePnl(p, cur.price) : null;
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink-muted">
                    Your {p.direction.toLowerCase()} on {p.accountLabel}
                    {exact ? "" : ` (${p.symbol})`} · entry{" "}
                    <span className="figures text-ink">
                      {p.entryPrice ? formatPrice(Number(p.entryPrice)) : "—"}
                    </span>
                    {p.leverage ? ` · ${Number(p.leverage)}x` : ""}
                    {p.liquidationPrice && Number(p.liquidationPrice) > 0 ? (
                      <>
                        {" "}
                        · liquidation{" "}
                        <span className="figures text-ink">
                          {formatPrice(Number(p.liquidationPrice))}
                        </span>
                      </>
                    ) : null}
                  </span>
                  {pnl !== null && (
                    <span
                      className={cn(
                        "figures font-semibold",
                        pnl >= 0 ? "text-profit" : "text-loss",
                      )}
                    >
                      {usd(pnl)} live
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </ChartWorkspace>

      <aside
        className="surface grid min-w-0 content-start gap-3 rounded-[var(--radius-surface)] p-4"
        aria-label="Coins"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Top {TOP} by volume</h2>
          <span className="text-xs text-ink-faint">{STATUS_TEXT[listStatus]}</span>
        </div>
        <label className="relative block">
          <span className="sr-only">Search coins</span>
          <Search
            className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-ink-faint"
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search, e.g. PEPE"
            className="h-9 w-full rounded-full border border-rule bg-canvas pr-3 pl-9 text-sm text-ink placeholder:text-ink-faint focus:border-coach focus:outline-none"
          />
        </label>
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">Popular markets</legend>
          {PINNED.map((p) => {
            const t = tickers.current.get(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => go(p)}
                aria-current={p === symbol ? "true" : undefined}
                className={cn(
                  "figures inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs",
                  p === symbol
                    ? "border-coach bg-coach/15 text-ink"
                    : "border-rule text-ink-muted hover:text-ink",
                )}
              >
                <span className="font-medium text-ink">
                  {TRADFI_NAMES[p] ?? p.replace(/USDT$/, "")}
                </span>
                {t && (
                  <span className={t.change >= 0 ? "text-profit" : "text-loss"}>
                    {formatChange(t.change)}
                  </span>
                )}
              </button>
            );
          })}
        </fieldset>
        {listStatus === "blocked" ? (
          <p className="text-sm text-ink-muted">
            Binance does not serve live prices in your region, so live markets are unavailable here.
            Everything else in WickMentor works as normal.
          </p>
        ) : list.length === 0 ? (
          <p className="text-sm text-ink-muted">Loading live prices…</p>
        ) : (
          <ul className="relative -mx-2 grid max-h-[34rem] overflow-y-auto xl:max-h-[calc(100dvh-14rem)]">
            {list.map((t) => (
              <li key={t.symbol} className="flex items-center">
                <button
                  type="button"
                  onClick={() => toggleFav(t.symbol)}
                  className="flex h-9 w-8 shrink-0 items-center justify-center text-ink-faint hover:text-[#f59e0b]"
                >
                  <Star
                    className={cn(
                      "h-3.5 w-3.5",
                      favs.includes(t.symbol) && "fill-[#f59e0b] text-[#f59e0b]",
                    )}
                    aria-hidden="true"
                  />
                  <span className="sr-only">
                    {favs.includes(t.symbol) ? "Remove" : "Add"} {t.symbol} favourite
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => go(t.symbol)}
                  aria-current={t.symbol === symbol ? "true" : undefined}
                  className={cn(
                    "grid flex-1 grid-cols-[1fr_auto_4.5rem] items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-sm",
                    t.symbol === symbol ? "bg-coach/15" : "hover:bg-hi/[0.06]",
                  )}
                >
                  <span className="truncate font-medium">
                    {t.symbol.replace(/USDT$/, "")}
                    {TRADFI_NAMES[t.symbol] && (
                      <span className="ml-1.5 rounded bg-[#f59e0b]/20 px-1 text-[10px] text-[#f59e0b]">
                        {TRADFI_NAMES[t.symbol]}
                      </span>
                    )}
                    {openSymbols.has(t.symbol) && (
                      <span className="ml-1.5 rounded bg-coach/20 px-1 text-[10px] text-coach">
                        open
                      </span>
                    )}
                  </span>
                  <span className="figures text-right tabular-nums">{formatPrice(t.price)}</span>
                  <span
                    className={cn(
                      "figures text-right text-xs tabular-nums",
                      t.change >= 0 ? "text-profit" : "text-loss",
                    )}
                  >
                    {formatChange(t.change)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
