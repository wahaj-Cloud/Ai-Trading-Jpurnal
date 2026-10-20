import {
  fixedMinus,
  type MarketPulseDto,
  marketPulseQuerySchema,
  PULSE_DISCLAIMER,
  PULSE_LINKS,
  PULSE_MIN_GROUP,
  PULSE_WINDOWS,
  type PulseLink,
  type PulseMyTradesDto,
} from "@atc/shared";
import { Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Panel } from "@/features/analytics/metric";
import { convertPulseMine } from "@/features/currency/convert";
import { FreshnessBadge } from "@/features/live-flow/freshness";
import { formatPercent, formatPnl } from "@/features/trades/format";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getDisplay } from "@/lib/display";

export const metadata = { title: "Market Pulse" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Q = { window: string; sort: string; filter: string };

const LINK_TONE: Record<PulseLink, string> = {
  FOLLOWS: "bg-coach/15 text-coach",
  LOOSE: "bg-hi/10 text-ink",
  INDEPENDENT: "bg-[#f59e0b]/15 text-[#f59e0b]",
  OPPOSITE: "bg-loss/15 text-loss",
};
const SORTS = [
  { id: "volume", label: "Volume" },
  { id: "corr", label: "Correlation" },
  { id: "beta", label: "Beta" },
  { id: "rs", label: "Strength vs BTC" },
];

function href(q: Q, patch: Partial<Q>) {
  const next = { ...q, ...patch };
  const p = new URLSearchParams();
  if (next.window !== "24h") p.set("window", next.window);
  if (next.sort !== "volume") p.set("sort", next.sort);
  if (next.filter !== "all") p.set("filter", next.filter);
  return `/market${p.size ? `?${p}` : ""}`;
}

function Chip({
  href: to,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={to}
      scroll={false}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap transition-colors",
        active
          ? "border-coach/60 bg-coach/15 font-medium text-ink"
          : "border-rule text-ink-muted hover:bg-hi/[0.06] hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

const signedPct = (v: number, dp = 2) => {
  const shown = Number((v * 100).toFixed(dp));
  return `${shown > 0 ? "+" : shown < 0 ? "−" : ""}${Math.abs(shown).toFixed(dp)}%`;
};
const _ago = (iso: string | null) => {
  if (!iso) return "not yet";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/** Market Pulse: which coins move with BTC today. Context for the trader, not a signal. */
export default async function MarketPulsePage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const parsed = marketPulseQuerySchema.safeParse({
    window: typeof raw.window === "string" ? raw.window : undefined,
    sort: typeof raw.sort === "string" ? raw.sort : undefined,
    filter: typeof raw.filter === "string" ? raw.filter : undefined,
  });
  const q = parsed.success ? parsed.data : marketPulseQuerySchema.parse({});
  const [pulse, mine, display] = await Promise.all([
    apiFetch<MarketPulseDto>(`/v1/market/pulse?${new URLSearchParams(q)}`),
    apiFetch<PulseMyTradesDto>("/v1/market/pulse/me").catch(() => null),
    getDisplay(),
  ]);
  const my = mine ? convertPulseMine(mine, display) : null;
  const locked = q.window !== "24h" && pulse.locked.windows;

  return (
    <div className="mx-auto grid max-w-7xl gap-6 grid-cols-[minmax(0,1fr)]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Market Pulse</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            How closely each top futures coin is moving with Bitcoin. A coin that "follows BTC"
            usually moves when BTC moves; "decoupled today" means it normally follows BTC but is
            doing its own thing right now.
          </p>
        </div>
        <p className="text-xs text-ink-faint">
          <FreshnessBadge at={pulse.computedAt} every="every hour" staleAfterMs={2 * 3_600_000} />
          {pulse.btcReturn !== null && (
            <>
              {" "}
              · BTC {q.window}{" "}
              <span className={pulse.btcReturn >= 0 ? "text-profit" : "text-loss"}>
                {signedPct(pulse.btcReturn)}
              </span>
            </>
          )}
        </p>
      </header>

      <section
        aria-label="Filters"
        className="surface grid gap-3 rounded-[var(--radius-surface)] p-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-xs font-medium tracking-wide text-ink-faint uppercase">
            Window
          </span>
          {PULSE_WINDOWS.map((w) => (
            <Chip key={w} href={href(q, { window: w })} active={q.window === w}>
              {w}
              {w !== "24h" && pulse.locked.windows && <Lock className="h-3 w-3" aria-label="Pro" />}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-xs font-medium tracking-wide text-ink-faint uppercase">
            Show
          </span>
          <Chip href={href(q, { filter: "all" })} active={q.filter === "all"}>
            All
          </Chip>
          {(Object.keys(PULSE_LINKS) as PulseLink[]).map((k) => (
            <Chip key={k} href={href(q, { filter: k })} active={q.filter === k}>
              {PULSE_LINKS[k]} <span className="text-ink-faint">{pulse.totals[k]}</span>
            </Chip>
          ))}
          <Chip href={href(q, { filter: "decoupled" })} active={q.filter === "decoupled"}>
            Decoupled today <span className="text-ink-faint">{pulse.totals.decoupled}</span>
          </Chip>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-xs font-medium tracking-wide text-ink-faint uppercase">
            Sort
          </span>
          {SORTS.map((s) => (
            <Chip key={s.id} href={href(q, { sort: s.id })} active={q.sort === s.id}>
              {s.label}
            </Chip>
          ))}
        </div>
      </section>

      <Panel
        title={`Coins vs BTC · ${q.window}`}
        action={
          pulse.locked.hiddenCoins > 0 && !locked ? (
            <Link href="/billing" className="text-xs text-coach underline-offset-4 hover:underline">
              {pulse.locked.hiddenCoins} more coins on Pro
            </Link>
          ) : undefined
        }
      >
        {locked ? (
          <div className="grid justify-items-start gap-3 text-sm text-ink-muted">
            <p>The 7-day and 30-day views are part of Pro. The 24-hour view is free.</p>
            <Link href="/billing" className="text-coach underline-offset-4 hover:underline">
              See plans
            </Link>
          </div>
        ) : pulse.rows.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {pulse.computedAt
              ? "No coins match this filter right now."
              : "Market Pulse is warming up. The first update arrives within the hour."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-faint">
                  <th scope="col" className="pb-2 font-medium">
                    #
                  </th>
                  <th scope="col" className="pb-2 font-medium">
                    Coin
                  </th>
                  <th scope="col" className="pb-2 font-medium">
                    Link to BTC
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    Correlation
                  </th>
                  <th
                    scope="col"
                    className="pb-2 text-right font-medium"
                    title="How hard it moves when BTC moves 1%"
                  >
                    Beta
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    Move
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    vs BTC
                  </th>
                </tr>
              </thead>
              <tbody className="figures">
                {pulse.rows.map((r) => (
                  <tr key={r.symbol} className="border-t border-hi/10">
                    <td className="py-2 text-ink-faint">{r.rank}</td>
                    <td className="py-2">
                      <Link
                        href={`/market/${r.symbol}`}
                        className="font-medium text-ink underline-offset-4 hover:underline"
                      >
                        {r.symbol.replace(/USDT$/, "")}
                      </Link>
                    </td>
                    <td className="py-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs whitespace-nowrap",
                          LINK_TONE[r.link],
                        )}
                      >
                        {PULSE_LINKS[r.link]}
                      </span>
                      {r.decoupled && (
                        <span className="ml-1 rounded-full bg-[#f59e0b]/15 px-2 py-0.5 text-xs whitespace-nowrap text-[#f59e0b]">
                          decoupled today
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">{fixedMinus(r.corr, 2)}</td>
                    <td className="py-2 text-right">{fixedMinus(r.beta, 2)}</td>
                    <td
                      className={cn(
                        "py-2 text-right",
                        r.coinReturn >= 0 ? "text-profit" : "text-loss",
                      )}
                    >
                      {signedPct(r.coinReturn)}
                    </td>
                    <td
                      className={cn(
                        "py-2 text-right",
                        r.relStrength >= 0 ? "text-profit" : "text-loss",
                      )}
                    >
                      {signedPct(r.relStrength)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {my && my.total > 0 && (
        <Panel title="Your trades by link to BTC">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {my.groups.map((g) => (
              <li key={g.link} className="rounded-[var(--radius-control)] border border-rule p-4">
                <p className="text-sm font-medium">{PULSE_LINKS[g.link]}</p>
                {g.enough ? (
                  <dl className="figures mt-2 grid gap-1 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">Trades</dt>
                      <dd>{g.trades}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">Win rate</dt>
                      <dd>{formatPercent(g.winRate)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">Net</dt>
                      <dd className={Number(g.netPnl) >= 0 ? "text-profit" : "text-loss"}>
                        {formatPnl(g.netPnl, display.code)}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-2 text-sm text-ink-muted">
                    {g.trades} trade{g.trades === 1 ? "" : "s"} · needs {PULSE_MIN_GROUP} to compare
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-faint">
            Each trade is stamped with its coin's 24-hour correlation to BTC when you entered. The
            AI coach uses the same groups.
          </p>
        </Panel>
      )}
      <p className="text-xs text-ink-faint">{PULSE_DISCLAIMER}</p>
    </div>
  );
}
