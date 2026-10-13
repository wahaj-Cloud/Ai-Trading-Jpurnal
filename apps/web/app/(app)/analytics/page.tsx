import {
  ANALYTICS_RANGES,
  type AnalyticsRange,
  EMOTIONS,
  type EmotionCode,
  EXCHANGE_CATALOG,
  isExchangeId,
  MISTAKES,
  type MistakeCode,
  SESSIONS,
  type SessionId,
} from "@atc/shared";
import { BarChart3 } from "lucide-react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { BucketTable } from "@/features/analytics/bucket-table";
import { getAnalytics, getStrategyInsights } from "@/features/analytics/load";
import { Panel } from "@/features/analytics/metric";
import { SessionVerdictCard } from "@/features/analytics/session-verdict-card";
import { SummaryGrid } from "@/features/analytics/summary-grid";
import { CalendarHeatmap } from "@/features/charts/calendar-heatmap";
import { PnlColumns } from "@/features/charts/pnl-columns";
import { TimeSeriesChart } from "@/features/charts/time-series-chart";
import { ExchangeMark } from "@/features/exchanges/exchange-mark";
import { getExchangeAccounts } from "@/features/exchanges/load";
import { StrategyInsights } from "@/features/strategy/insights";
import { cn } from "@/lib/cn";

export const metadata = { title: "Analytics" };

const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
  ytd: "YTD",
  "1y": "1Y",
  all: "All",
};
const monthShort = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
const hourLabel = (h: string) => `${h.padStart(2, "0")}:00`;

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-full border px-3 py-1 text-sm",
        active ? "border-coach text-ink" : "border-rule text-ink-muted hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; exchange?: string }>;
}) {
  const params = await searchParams;
  const range = (ANALYTICS_RANGES as readonly string[]).includes(params.range ?? "")
    ? (params.range as AnalyticsRange)
    : "all";
  const exchange = params.exchange && isExchangeId(params.exchange) ? params.exchange : undefined;
  const RANGE_DAYS: Record<AnalyticsRange, number> = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
    ytd: 366,
    "1y": 365,
    all: 3650,
  };
  const [report, { accounts }, insights] = await Promise.all([
    getAnalytics(range, exchange),
    getExchangeAccounts(),
    getStrategyInsights(RANGE_DAYS[range]).catch(() => []),
  ]);
  const exchanges = [...new Set(accounts.map((a) => a.exchange))];
  const href = (next: { range?: string; exchange?: string }) => {
    const q = new URLSearchParams(
      Object.entries({ range, exchange, ...next }).filter(
        (e): e is [string, string] => Boolean(e[1]) && !(e[0] === "range" && e[1] === "all"),
      ),
    ).toString();
    return q ? `/analytics?${q}` : "/analytics";
  };

  const s = report.summary;
  const months = [...new Set(report.daily.map((d) => d.date.slice(0, 7)))].reverse().slice(0, 6);
  const hasJournal = report.bySetup.length + report.byMistake.length + report.byEmotion.length > 0;

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Closed trades
            {report.range.from ? ` from ${report.range.from}` : ""} to {report.range.to}. Days and
            hours in {report.range.timezone}.
            {report.historyLimitedFrom && (
              <>
                {" "}
                Your plan shows history from {report.historyLimitedFrom.slice(0, 10)}.{" "}
                <Link href="/billing" className="text-ink underline underline-offset-4">
                  Upgrade for more
                </Link>
              </>
            )}
          </p>
        </div>
        <nav aria-label="Period" className="flex flex-wrap gap-1">
          {ANALYTICS_RANGES.map((r) => (
            <Chip key={r} href={href({ range: r })} active={range === r}>
              {RANGE_LABELS[r]}
            </Chip>
          ))}
        </nav>
      </header>

      {exchanges.length > 1 && (
        <nav aria-label="Exchange" className="-mt-2 flex flex-wrap gap-1">
          <Chip href={href({ exchange: "" })} active={!exchange}>
            All exchanges
          </Chip>
          {exchanges.map((e) => (
            <Chip key={e} href={href({ exchange: e })} active={exchange === e}>
              <span className="inline-flex items-center gap-1.5">
                <ExchangeMark exchange={e} size="xs" />
                {EXCHANGE_CATALOG[e].name}
              </span>
            </Chip>
          ))}
        </nav>
      )}

      {s.trades === 0 ? (
        <section className="rounded-[var(--radius-surface)] surface p-8 text-center">
          <BarChart3 className="mx-auto h-6 w-6 text-coach" aria-hidden="true" />
          <h2 className="mt-3 font-semibold">No closed trades in this period</h2>
          <p className="mx-auto mt-2 max-w-[52ch] text-sm text-ink-muted">
            Choose a longer period, or connect an exchange so your trades sync automatically.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            {range !== "all" && (
              <ButtonLink href={href({ range: "all" })}>Show all time</ButtonLink>
            )}
            <ButtonLink href="/exchanges" variant="secondary">
              Exchanges
            </ButtonLink>
          </div>
        </section>
      ) : (
        <>
          <SummaryGrid s={s} />

          <Panel title="Equity curve">
            <TimeSeriesChart
              kind="equity"
              height={300}
              points={report.daily.map((d) => ({ date: d.date, value: Number(d.cumulative) }))}
            />
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Daily P&L">
              <TimeSeriesChart
                kind="daily"
                points={report.daily.map((d) => ({ date: d.date, value: Number(d.pnl) }))}
              />
            </Panel>
            <Panel title="Drawdown">
              <TimeSeriesChart
                kind="drawdown"
                points={report.daily.map((d) => ({ date: d.date, value: Number(d.drawdown) }))}
              />
            </Panel>
          </div>

          <Panel title="Calendar">
            <CalendarHeatmap months={months} days={report.daily} today={report.range.to ?? ""} />
          </Panel>

          <Panel title="Your best trading session">
            <SessionVerdictCard buckets={report.bySession} timeZone={report.range.timezone} />
          </Panel>

          <Panel title="When you trade best">
            <div className="grid gap-8 lg:grid-cols-[2fr_1fr_1fr]">
              <PnlColumns title="By hour you opened" buckets={report.byHour} label={hourLabel} />
              <PnlColumns title="By weekday" buckets={report.byWeekday} />
              <PnlColumns
                title="By session"
                buckets={report.bySession}
                label={(k) => SESSIONS[k as SessionId]?.label ?? k}
              />
            </div>
            <p className="mt-4 text-xs text-ink-faint">
              Sessions by the time you opened the trade: Asia 00–07, London 07–13, New York 13–21,
              off-hours 21–24 UTC (shown in your own time above).
            </p>
          </Panel>

          <Panel title="Coins">
            <BucketTable buckets={report.bySymbol} keyLabel="Coin" />
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="By month">
              <PnlColumns
                title="Net P&L per month"
                buckets={report.monthly.slice(-12).map((m) => ({
                  key: m.month,
                  trades: m.trades,
                  wins: m.wins,
                  losses: m.trades - m.wins,
                  winRate: m.trades ? m.wins / m.trades : null,
                  pnl: m.pnl,
                  avgPnl: null,
                }))}
                label={(k) => monthShort.format(new Date(`${k}-01T00:00:00Z`))}
              />
            </Panel>
            <Panel title="Long vs short">
              <BucketTable
                buckets={report.byDirection.filter((b) => b.trades > 0)}
                keyLabel="Direction"
                label={(k) => (k === "LONG" ? "Long" : "Short")}
              />
            </Panel>
          </div>

          <Panel title="Entry quality">
            <StrategyInsights insights={insights} />
          </Panel>

          <Panel title="From your journal">
            {hasJournal ? (
              <div className="grid gap-8 lg:grid-cols-3">
                <div>
                  <h3 className="mb-2 text-sm font-medium">Setups</h3>
                  <BucketTable buckets={report.bySetup} keyLabel="Setup" empty="No setups yet." />
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-medium">Costliest mistakes</h3>
                  <BucketTable
                    buckets={report.byMistake}
                    keyLabel="Mistake"
                    label={(k) => MISTAKES[k as MistakeCode] ?? k}
                    empty="No mistakes logged."
                  />
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-medium">Emotions</h3>
                  <BucketTable
                    buckets={report.byEmotion}
                    keyLabel="Emotion"
                    label={(k) => EMOTIONS[k as EmotionCode] ?? k}
                    empty="No emotions logged."
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">
                Review trades to see which setups make money and which mistakes and emotions cost
                you the most.{" "}
                <Link href="/trades" className="text-ink underline underline-offset-4">
                  Review a trade
                </Link>
              </p>
            )}
          </Panel>

          {report.excluded.trades > 0 && (
            <p className="text-xs text-ink-faint">
              {report.excluded.trades} coin-margined trades (paid in{" "}
              {report.excluded.assets.join(", ")}) are not included in these USD figures.
            </p>
          )}
        </>
      )}
    </div>
  );
}
