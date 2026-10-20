import {
  BIAS_DEFINITION,
  BIAS_TIMEFRAMES,
  DESK_SYMBOLS,
  EXCHANGE_CATALOG,
  FLOW_DISCLAIMER,
  FLOW_EXCHANGES,
  FLOW_FREE_SYMBOLS,
  FLOW_SYMBOLS,
  FLOW_WINDOW_LABEL,
  FLOW_WINDOWS,
  type FlowFeedPage,
  type FlowSummaryDto,
  flowFeedQuerySchema,
  flowSummaryQuerySchema,
  type LiquidationDto,
  type MarketBiasDto,
  WHALE_MIN_USD,
  type WhaleTradeDto,
} from "@atc/shared";
import { Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Panel } from "@/features/analytics/metric";
import { BiasChip, FlowChart, signedUsd, usdCompact } from "@/features/flow/views";
import { AutoRefresh } from "@/features/labs/backtest-views";
import { formatPrice } from "@/features/live/market";
import { FreshnessBadge } from "@/features/live-flow/freshness";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

export const metadata = { title: "Market Flow" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const short = (s: string) =>
  s === "XAUUSDT" ? "Gold" : s === "XAGUSDT" ? "Silver" : s.replace(/USDT$/, "");
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60
    ? `${s}s ago`
    : s < 3600
      ? `${Math.round(s / 60)} min ago`
      : `${Math.round(s / 3600)} h ago`;
};

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

/**
 * Market Flow: whale trades and real liquidations from Binance, Bybit and OKX, with the trend bias
 * per timeframe. Refreshes every 15 seconds.
 */
export default async function FlowPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const q = flowSummaryQuerySchema.safeParse({ symbol: one(raw.s), window: one(raw.w) });
  const { symbol, window } = q.success ? q.data : flowSummaryQuerySchema.parse({});
  const feed = one(raw.feed) === "liquidations" ? "liquidations" : "whales";
  const fq = flowFeedQuerySchema.safeParse({
    symbol,
    exchange: one(raw.ex),
    side: one(raw.side),
    minUsd: one(raw.min),
    cursor: one(raw.cursor),
  });
  const feedQuery = fq.success ? fq.data : { symbol };
  const qs = new URLSearchParams(
    Object.entries(feedQuery).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])),
  );
  const [summary, list, bias] = await Promise.all([
    apiFetch<FlowSummaryDto>(`/v1/market/flow?symbol=${symbol}&window=${window}`),
    apiFetch<FlowFeedPage<WhaleTradeDto | LiquidationDto>>(`/v1/market/flow/${feed}?${qs}`),
    apiFetch<MarketBiasDto>("/v1/market/bias"),
  ]);
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = {
      s: symbol,
      w: window,
      feed,
      ex: one(raw.ex),
      side: one(raw.side),
      min: one(raw.min),
      ...patch,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/flow?${p}`;
  };
  const fullAccess = bias.allowed.length > 1;
  const row = bias.items.find((i) => i.symbol === symbol);
  const isDesk = (DESK_SYMBOLS as readonly string[]).includes(symbol);
  const s = summary;
  const liqTotal = s.liquidations.longUsd + s.liquidations.shortUsd;

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-6">
      <AutoRefresh every={15_000} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Market Flow</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            What big money and forced closes are doing right now: whale market orders and real
            liquidations from Binance, Bybit and OKX, with the trend on each timeframe.
          </p>
        </div>
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
          <FreshnessBadge
            at={
              s.sources
                .map((x) => (x.lastAt ? Date.parse(x.lastAt) : 0))
                .reduce((a, b) => Math.max(a, b), 0) || null
            }
            live={s.sources.some((x) => x.live)}
          />
          {s.sources.map((src) => (
            <span key={src.exchange} className="flex items-center gap-1">
              <span
                aria-hidden="true"
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  src.live ? "animate-pulse bg-profit" : "bg-ink-faint",
                )}
              />
              {EXCHANGE_CATALOG[src.exchange].name} {src.live ? "live" : "offline"}
            </span>
          ))}
        </p>
      </header>

      <nav aria-label="Markets" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {FLOW_SYMBOLS.map((m) => (
          <Chip key={m} href={href({ s: m, cursor: undefined })} active={m === symbol}>
            {short(m)}
            {!fullAccess && !FLOW_FREE_SYMBOLS.includes(m) && (
              <Lock className="h-3 w-3" aria-label="Pro" />
            )}
          </Chip>
        ))}
      </nav>

      {s.locked ? (
        <Panel title="Every market on Pro">
          <p className="text-sm text-ink-muted">
            The free plan shows Bitcoin and Ethereum flow.{" "}
            <Link href="/billing" className="text-coach underline-offset-4 hover:underline">
              See plans
            </Link>
          </p>
        </Panel>
      ) : (
        <>
          <section
            aria-label="Trend bias"
            className="surface grid gap-3 rounded-[var(--radius-surface)] p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">
                Trend bias · {short(symbol)}
                {row?.price ? (
                  <span className="figures ml-2 font-normal text-ink-muted">
                    {formatPrice(row.price)}
                  </span>
                ) : null}
              </h2>
              {isDesk && row ? (
                <div className="flex flex-wrap gap-2">
                  {BIAS_TIMEFRAMES.map((tf) => (
                    <BiasChip key={tf} bias={row.bias.find((b) => b.timeframe === tf)} showTf />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-muted">
                  {isDesk
                    ? "Trend bias for this market is on Pro."
                    : "Trend bias covers BTC, ETH, SOL, gold and silver."}
                </p>
              )}
            </div>
            {isDesk && row && (
              <ul className="grid gap-2 text-xs text-ink-muted md:grid-cols-3">
                {BIAS_TIMEFRAMES.map((tf) => {
                  const b = row.bias.find((x) => x.timeframe === tf);
                  return (
                    <li key={tf} className="rounded-[var(--radius-control)] border border-rule p-3">
                      <p className="mb-1 font-medium text-ink">
                        {tf.toUpperCase()}
                        {b ? ` · held ${b.bars}${b.bars >= 99 ? "+" : ""} candles` : ""}
                      </p>
                      {b ? b.evidence.map((e) => <p key={e}>{e}</p>) : <p>Being calculated.</p>}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-xs text-ink-faint">{BIAS_DEFINITION}</p>
          </section>

          <nav aria-label="Period" className="flex gap-2">
            {FLOW_WINDOWS.map((w) => (
              <Chip key={w} href={href({ w })} active={w === window}>
                {FLOW_WINDOW_LABEL[w]}
              </Chip>
            ))}
          </nav>

          <div className="grid gap-4 md:grid-cols-3">
            <section className="surface grid content-start gap-2 rounded-[var(--radius-surface)] p-5">
              <h2 className="text-sm text-ink-muted">
                Whale net flow · {FLOW_WINDOW_LABEL[window]}
              </h2>
              <p
                className={cn(
                  "figures text-3xl font-semibold",
                  s.whales.netUsd >= 0 ? "text-profit" : "text-loss",
                )}
              >
                {signedUsd(s.whales.netUsd)}
              </p>
              <p className="text-sm">
                <span className="text-profit">{usdCompact(s.whales.buyUsd)} bought</span> (
                {s.whales.buys}) ·{" "}
                <span className="text-loss">{usdCompact(s.whales.sellUsd)} sold</span> (
                {s.whales.sells})
              </p>
              <p className="text-xs text-ink-faint">
                Market orders of {usdCompact(WHALE_MIN_USD[symbol])} or more.
              </p>
            </section>
            <section className="surface grid content-start gap-2 rounded-[var(--radius-surface)] p-5">
              <h2 className="text-sm text-ink-muted">Liquidated · {FLOW_WINDOW_LABEL[window]}</h2>
              <p className="figures text-3xl font-semibold">{usdCompact(liqTotal)}</p>
              <p className="text-sm">
                <span className="text-[#a78bfa]">Longs {usdCompact(s.liquidations.longUsd)}</span> ·{" "}
                <span className="text-[#f59e0b]">Shorts {usdCompact(s.liquidations.shortUsd)}</span>
              </p>
              {liqTotal > 0 && (
                <div className="flex h-2 overflow-hidden rounded-full" aria-hidden="true">
                  <span
                    className="bg-[#8B5CF6]"
                    style={{ width: `${(s.liquidations.longUsd / liqTotal) * 100}%` }}
                  />
                  <span className="flex-1 bg-[#f59e0b]" />
                </div>
              )}
            </section>
            <section className="surface grid content-start gap-2 rounded-[var(--radius-surface)] p-5">
              <h2 className="text-sm text-ink-muted">Liquidations by exchange</h2>
              {s.liquidations.byExchange.length === 0 ? (
                <p className="text-sm text-ink-muted">None in this period.</p>
              ) : (
                <ul className="grid gap-1 text-sm">
                  {s.liquidations.byExchange.map((e) => (
                    <li key={e.exchange} className="figures flex justify-between gap-3">
                      <span>{EXCHANGE_CATALOG[e.exchange].name}</span>
                      <span>
                        {usdCompact(e.longUsd + e.shortUsd)}{" "}
                        <span className="text-xs text-ink-faint">({e.count})</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {s.liquidations.largest && (
                <p className="text-xs text-ink-muted">
                  Largest: {s.liquidations.largest.side} {usdCompact(s.liquidations.largest.usd)} at{" "}
                  {formatPrice(s.liquidations.largest.price)} on{" "}
                  {EXCHANGE_CATALOG[s.liquidations.largest.exchange].name},{" "}
                  {ago(s.liquidations.largest.at)}
                </p>
              )}
            </section>
          </div>

          <Panel title={`Flow over the last ${FLOW_WINDOW_LABEL[window]}`}>
            <FlowChart series={s.series} />
          </Panel>

          <section
            aria-label="Feed"
            className="surface grid gap-4 rounded-[var(--radius-surface)] p-5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Chip
                href={href({ feed: "whales", side: undefined, cursor: undefined })}
                active={feed === "whales"}
              >
                Whale trades
              </Chip>
              <Chip
                href={href({ feed: "liquidations", side: undefined, cursor: undefined })}
                active={feed === "liquidations"}
              >
                Liquidations
              </Chip>
              <span className="mx-1 h-5 w-px bg-rule" aria-hidden="true" />
              <Chip href={href({ ex: undefined })} active={!one(raw.ex)}>
                All exchanges
              </Chip>
              {FLOW_EXCHANGES.map((e) => (
                <Chip key={e} href={href({ ex: e })} active={one(raw.ex) === e}>
                  {EXCHANGE_CATALOG[e].name}
                </Chip>
              ))}
              <span className="mx-1 h-5 w-px bg-rule" aria-hidden="true" />
              {(feed === "whales" ? ["buy", "sell"] : ["long", "short"]).map((sd) => (
                <Chip
                  key={sd}
                  href={href({ side: one(raw.side) === sd ? undefined : sd })}
                  active={one(raw.side) === sd}
                >
                  {feed === "whales"
                    ? sd === "buy"
                      ? "Buys"
                      : "Sells"
                    : sd === "long"
                      ? "Longs"
                      : "Shorts"}
                </Chip>
              ))}
              {["1000000"].map((m) => (
                <Chip
                  key={m}
                  href={href({ min: one(raw.min) === m ? undefined : m })}
                  active={one(raw.min) === m}
                >
                  $1M+
                </Chip>
              ))}
            </div>
            {list.items.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Nothing yet for these filters. New rows appear within seconds.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-faint">
                      <th scope="col" className="pb-2 font-medium">
                        Time
                      </th>
                      <th scope="col" className="pb-2 font-medium">
                        Exchange
                      </th>
                      <th scope="col" className="pb-2 font-medium">
                        Side
                      </th>
                      <th scope="col" className="pb-2 text-right font-medium">
                        Price
                      </th>
                      <th scope="col" className="pb-2 text-right font-medium">
                        Size
                      </th>
                      <th scope="col" className="pb-2 text-right font-medium">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.items.map((r) => {
                      const good = r.side === "buy" || r.side === "short";
                      const label =
                        r.side === "buy"
                          ? "Buy"
                          : r.side === "sell"
                            ? "Sell"
                            : r.side === "long"
                              ? "Long liquidated"
                              : "Short liquidated";
                      return (
                        <tr key={r.id} className="border-t border-rule">
                          <td className="py-2 text-ink-muted">{ago(r.at)}</td>
                          <td>{EXCHANGE_CATALOG[r.exchange].name}</td>
                          <td className={good ? "text-profit" : "text-loss"}>{label}</td>
                          <td className="figures text-right">{formatPrice(r.price)}</td>
                          <td className="figures text-right">
                            {r.qty.toLocaleString("en", { maximumFractionDigits: 4 })}
                          </td>
                          <td className="figures text-right font-medium">{usdCompact(r.usd)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {list.nextCursor && (
              <Link
                href={`${href({})}&cursor=${list.nextCursor}`}
                className="text-sm text-coach underline-offset-4 hover:underline"
              >
                Older
              </Link>
            )}
          </section>
        </>
      )}
      <p className="text-xs text-ink-faint">{FLOW_DISCLAIMER}</p>
    </div>
  );
}
