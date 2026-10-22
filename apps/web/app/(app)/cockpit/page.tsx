import {
  BIAS_TIMEFRAMES,
  COCKPIT_DISCLAIMER,
  COCKPIT_TFS,
  type CockpitDto,
  cockpitQuerySchema,
  DESK_SYMBOLS,
  type ExchangeId,
  planFromQuery,
  RATING_TFS,
  type RatingTf,
  SCALP_PINNED,
  type ScalpAlertsPage,
  type ZoneAlertsPage,
} from "@atc/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import { Panel } from "@/features/analytics/metric";
import { ScalpAlerts } from "@/features/cockpit/alerts";
import { IndicatorGauges } from "@/features/cockpit/gauges";
import { CockpitBoard } from "@/features/cockpit/live-board";
import { ZoneAlerts } from "@/features/cockpit/zone-alerts";
import { getExchangeAccounts } from "@/features/exchanges/load";
import { BiasChip } from "@/features/flow/views";
import { AutoRefresh } from "@/features/labs/backtest-views";
import { coinName, usd } from "@/features/orderflow/format";
import { formatPnl } from "@/features/trades/format";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

export const metadata = { title: "Scalp Cockpit" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

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
const inMin = (iso: string) => Math.round((Date.parse(iso) - Date.now()) / 60_000);

/**
 * Scalp Cockpit: one market, everything the app knows, read for a 5- or 15-minute trade. Refreshes
 * every 20 seconds (the figures behind it update every minute).
 */
export default async function CockpitPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const parsed = cockpitQuerySchema.safeParse({ symbol: one(raw.s), tf: one(raw.tf) });
  const gaugeTf: RatingTf = (RATING_TFS as readonly string[]).includes(one(raw.g) ?? "")
    ? (one(raw.g) as RatingTf)
    : one(raw.tf) === "15m"
      ? "15m"
      : "5m";
  const q = parsed.success ? parsed.data : cockpitQuerySchema.parse({});
  const [dto, alerts, zoneAlerts, accounts] = await Promise.all([
    apiFetch<CockpitDto>(`/v1/market/cockpit?symbol=${q.symbol}&tf=${q.tf}`),
    apiFetch<ScalpAlertsPage>("/v1/scalp-alerts").catch(() => null),
    apiFetch<ZoneAlertsPage>("/v1/zone-alerts").catch(() => null),
    getExchangeAccounts().catch(() => null),
  ]);
  // A plan from an alert's link belongs to the market it was sent for.
  const fromAlert = one(raw.s) === q.symbol ? planFromQuery(raw) : null;
  const exchanges = [
    ...new Set(
      (accounts?.accounts ?? [])
        .filter((a) => a.status === "ACTIVE")
        .map((a) => a.exchange as ExchangeId),
    ),
  ];
  const href = (patch: { s?: string; tf?: string; g?: string }) => {
    const p = new URLSearchParams({ s: patch.s ?? q.symbol, tf: patch.tf ?? q.tf });
    if (patch.g) p.set("g", patch.g);
    return `/cockpit?${p}`;
  };
  const quick = [
    ...new Set([
      "XAUUSDT",
      "BTCUSDT",
      "ETHUSDT",
      ...SCALP_PINNED,
      "SOLUSDT",
      ...dto.symbols.slice(0, 6),
    ]),
  ].filter((s) => dto.symbols.includes(s));
  const c = dto.coin;

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-5">
      {/* Readings are live; a reload every 60 seconds refreshes news, whales and the trend. */}
      <AutoRefresh every={60_000} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scalp Cockpit</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            Everything WickMentor reads about one market on one screen, for a 5- or 15-minute trade:
            buying and selling, positioning, big money, levels, liquidation pools, news and your own
            record.
          </p>
        </div>
        <p className="text-xs text-ink-faint">
          Session: <span className="text-ink">{dto.session}</span>
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Market" className="-mx-1 flex max-w-full gap-2 overflow-x-auto px-1 pb-1">
          {quick.map((s) => (
            <Chip key={s} href={href({ s })} active={s === q.symbol}>
              {coinName(s)}
            </Chip>
          ))}
          <form action="/cockpit" className="flex items-center">
            <input type="hidden" name="tf" value={q.tf} />
            <label htmlFor="cockpit-market" className="sr-only">
              Any market
            </label>
            <select
              id="cockpit-market"
              name="s"
              defaultValue={quick.includes(q.symbol) ? "" : q.symbol}
              className="h-8 rounded-full border border-rule bg-transparent px-3 text-sm text-ink-muted"
            >
              <option value="" disabled>
                More…
              </option>
              {dto.symbols.map((s) => (
                <option key={s} value={s}>
                  {coinName(s)}
                </option>
              ))}
            </select>
            <button type="submit" className="ml-1 h-8 rounded-full border border-rule px-3 text-sm">
              Open
            </button>
          </form>
        </nav>
        <nav aria-label="Timeframe" className="flex gap-2">
          {COCKPIT_TFS.map((tf) => (
            <Chip key={tf} href={href({ tf })} active={tf === q.tf}>
              {tf} scalp
            </Chip>
          ))}
        </nav>
      </div>

      {!c ? (
        <Panel title={coinName(q.symbol)}>
          <p className="text-sm text-ink-muted">
            {dto.locked.length > 0 ? (
              <>
                Your plan covers the top 20 coins, gold and silver.{" "}
                <Link href="/billing" className="text-coach underline-offset-4 hover:underline">
                  See plans
                </Link>
              </>
            ) : (
              "This market is not in the scan right now (the 100 most traded futures, gold and silver)."
            )}
          </p>
        </Panel>
      ) : (
        <>
          <CockpitBoard
            dto={dto}
            tf={q.tf}
            renderedAt={Date.now()}
            fromAlert={fromAlert}
            exchanges={exchanges}
            gauges={
              <Panel title="Indicator gauges">
                <div id="gauges" className="scroll-mt-24">
                  <IndicatorGauges
                    ratings={dto.ratings}
                    tf={gaugeTf}
                    href={(g) => `${href({ g })}#gauges`}
                  />
                </div>
              </Panel>
            }
            bigMoney={
              <Panel title={`Big money · last ${q.tf}`}>
                {dto.whales ? (
                  <dl className="figures grid gap-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">Whale buys</dt>
                      <dd className="text-profit">
                        {usd(dto.whales.buyUsd).replace("+", "")} ({dto.whales.buys})
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">Whale sells</dt>
                      <dd className="text-loss">
                        {usd(dto.whales.sellUsd).replace("+", "")} ({dto.whales.sells})
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">Longs liquidated</dt>
                      <dd>{usd(dto.liquidations?.longUsd ?? 0).replace("+", "")}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">Shorts liquidated</dt>
                      <dd>{usd(dto.liquidations?.shortUsd ?? 0).replace("+", "")}</dd>
                    </div>
                    <dd>
                      <Link
                        href={`/flow?s=${q.symbol}&w=${q.tf}`}
                        className="text-sm text-coach underline-offset-4 hover:underline"
                      >
                        Live whale and liquidation feed
                      </Link>
                    </dd>
                  </dl>
                ) : (
                  <p className="text-sm text-ink-muted">
                    {dto.locked.includes("whale orders and liquidations")
                      ? "Whale orders and liquidations for this market are on Pro."
                      : "Whale and liquidation feeds cover BTC, ETH, SOL, XRP, DOGE, BNB, SUI, ADA, LINK, AVAX, gold and silver."}
                  </p>
                )}
              </Panel>
            }
          />

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="News">
              <ul className="grid gap-2 text-sm">
                {dto.events.map((e) => {
                  const m = inMin(e.startsAt);
                  return (
                    <li key={e.title + e.startsAt} className="flex justify-between gap-2">
                      <span>
                        {e.title} <span className="text-xs text-ink-faint">{e.currency}</span>
                      </span>
                      <span
                        className={cn(
                          "figures text-xs",
                          Math.abs(m) <= 30 ? "font-semibold text-loss" : "text-ink-muted",
                        )}
                      >
                        {m > 0
                          ? `in ${m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`}`
                          : `${-m} min ago`}
                      </span>
                    </li>
                  );
                })}
                {dto.headlines.map((h) => (
                  <li key={h.title} className="border-t border-rule pt-2">
                    <span className="text-xs text-ink-faint">
                      {ago(h.publishedAt)} · High impact
                    </span>
                    <p>{h.title}</p>
                  </li>
                ))}
                {dto.events.length === 0 && dto.headlines.length === 0 && (
                  <li className="text-ink-muted">
                    No high-impact release in the next 4 hours and no high-impact headline in the
                    last hour.
                  </li>
                )}
              </ul>
            </Panel>
            <Panel title="Trend">
              {dto.bias.length > 0 ? (
                <div className="grid gap-2">
                  <div className="flex flex-wrap gap-2">
                    {BIAS_TIMEFRAMES.map((tf) => (
                      <BiasChip key={tf} bias={dto.bias.find((b) => b.timeframe === tf)} showTf />
                    ))}
                  </div>
                  <p className="text-xs text-ink-faint">
                    From closed candles: price against its 50 EMA, the 50 against the 200, and the
                    last break of swing structure.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-ink-muted">
                  {dto.locked.includes("trend bias")
                    ? "Trend bias for this market is on Pro."
                    : (DESK_SYMBOLS as readonly string[]).includes(q.symbol)
                      ? "Being calculated."
                      : "Trend bias covers BTC, ETH, SOL, gold and silver."}
                </p>
              )}
            </Panel>
            <Panel title={`Your scalps on ${dto.name}`}>
              {dto.record ? (
                <div className="grid gap-2 text-sm">
                  <p className="figures">
                    {dto.record.trades} trade{dto.record.trades === 1 ? "" : "s"} held up to 1 hour
                    · win rate{" "}
                    {dto.record.winRate === null ? "—" : `${Math.round(dto.record.winRate * 100)}%`}{" "}
                    ·{" "}
                    <span className={Number(dto.record.netPnl) >= 0 ? "text-profit" : "text-loss"}>
                      {formatPnl(dto.record.netPnl)}
                    </span>
                  </p>
                  <ul className="figures grid gap-1 text-xs">
                    {dto.record.sessions.map((s) => (
                      <li
                        key={s.id}
                        className={cn(
                          "flex justify-between rounded px-2 py-1",
                          dto.session.startsWith(s.label) && "bg-coach/10",
                        )}
                      >
                        <span>{s.label}</span>
                        <span>
                          {s.trades} ·{" "}
                          {s.winRate === null ? "—" : `${Math.round(s.winRate * 100)}%`} ·{" "}
                          <span className={Number(s.netPnl) >= 0 ? "text-profit" : "text-loss"}>
                            {formatPnl(s.netPnl)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {dto.record.readings.groups.length > 0 && (
                    <div className="grid gap-1 border-t border-rule pt-2">
                      <p className="text-xs text-ink-faint">
                        By the {q.tf} readings when you entered (
                        {`${dto.record.readings.stamped} trade${dto.record.readings.stamped === 1 ? "" : "s"}`}{" "}
                        recorded):
                      </p>
                      <ul className="figures grid gap-1 text-xs">
                        {dto.record.readings.groups.map((g) => (
                          <li key={g.key} className="flex justify-between rounded px-2 py-1">
                            <span>{g.label}</span>
                            <span>
                              {g.trades} ·{" "}
                              {g.winRate === null ? "—" : `${Math.round(g.winRate * 100)}%`} ·{" "}
                              <span className={Number(g.netPnl) >= 0 ? "text-profit" : "text-loss"}>
                                {formatPnl(g.netPnl)}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {!dto.record.enough && (
                    <p className="text-xs text-ink-faint">
                      Fewer than 10 trades: too few to judge yet.
                    </p>
                  )}
                  <p className="text-xs text-ink-faint">
                    Last 180 days, every connected exchange and broker. The current session is
                    highlighted.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-ink-muted">
                  No closed scalps on this market in the last 180 days.
                </p>
              )}
            </Panel>
          </div>

          {(alerts || zoneAlerts) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {alerts && (
                <Panel title="Alert me: readings">
                  <ScalpAlerts
                    symbol={q.symbol}
                    tf={q.tf}
                    page={alerts}
                    readings={dto.rows.length}
                  />
                </Panel>
              )}
              {zoneAlerts && (
                <Panel title="Alert me: supply and demand zones">
                  <ZoneAlerts symbol={q.symbol} page={zoneAlerts} />
                </Panel>
              )}
            </div>
          )}

          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link
              href={`/live?s=${q.symbol}`}
              className="text-coach underline-offset-4 hover:underline"
            >
              Live chart
            </Link>
            <Link
              href={`/scalp?s=${q.symbol}`}
              className="text-coach underline-offset-4 hover:underline"
            >
              Scalping grid
            </Link>
            <Link
              href={`/orderflow?w=${q.tf}&c=${q.symbol}#coin`}
              className="text-coach underline-offset-4 hover:underline"
            >
              Order Flow
            </Link>
            {(DESK_SYMBOLS as readonly string[]).includes(q.symbol) && (
              <Link
                href={`/check?s=${q.symbol}`}
                className="text-coach underline-offset-4 hover:underline"
              >
                Trade Check
              </Link>
            )}
            <Link href="/calculators" className="text-coach underline-offset-4 hover:underline">
              Position size calculator
            </Link>
          </p>
        </>
      )}
      {dto.locked.length > 0 && c && (
        <p className="text-xs text-ink-faint">
          Not on your plan: {dto.locked.join(", ")}.{" "}
          <Link href="/billing" className="text-coach underline-offset-4 hover:underline">
            See plans
          </Link>
        </p>
      )}
      <p className="text-xs text-ink-faint">{COCKPIT_DISCLAIMER}</p>
    </div>
  );
}
