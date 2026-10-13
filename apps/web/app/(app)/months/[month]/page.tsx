import type { AnalyticsDto } from "@atc/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { getAnalytics } from "@/features/analytics/load";
import { Panel } from "@/features/analytics/metric";
import { CalendarHeatmap } from "@/features/charts/calendar-heatmap";
import { TimeSeriesChart } from "@/features/charts/time-series-chart";
import { MONTH_RE, monthDays, monthLabel, shiftMonth } from "@/features/months/month-stats";
import { MonthSummary } from "@/features/months/month-summary";
import { formatPercent, formatPnl } from "@/features/trades/format";
import { cn } from "@/lib/cn";

type Params = Promise<{ month: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { month } = await params;
  return { title: MONTH_RE.test(month) ? monthLabel(month) : "Month" };
}

const rowDate = new Intl.DateTimeFormat("en", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** One month in full: headline figures, the calendar, daily and running P&L, and every day listed. */
export default async function MonthPage({ params }: { params: Params }) {
  const { month } = await params;
  if (!MONTH_RE.test(month)) notFound();
  const report: AnalyticsDto | null = await getAnalytics("all").catch(() => null);
  const all = report?.daily ?? [];
  const days = monthDays(all, month);
  const today = report?.range.to ?? new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const firstMonth = all[0]?.date.slice(0, 7) ?? currentMonth;
  const prev = month > firstMonth ? shiftMonth(month, -1) : null;
  const next = month < currentMonth ? shiftMonth(month, 1) : null;
  const name = monthLabel(month);

  let running = 0;
  const rows = days.map((d) => {
    running += Number(d.pnl);
    return { ...d, running };
  });
  const maxAbs = Math.max(...days.map((d) => Math.abs(Number(d.pnl))), 0);
  const navCls = "rounded-full border border-hi/15 bg-hi/[0.06] px-3 py-1 text-sm";

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/dashboard" className="text-sm text-ink-muted hover:text-ink">
            ← Dashboard
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{name}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Every trading day of the month. Days use {report?.range.timezone ?? "your timezone"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Other months" className="flex gap-2">
            {prev ? (
              <Link href={`/months/${prev}`} className={cn(navCls, "hover:bg-hi/[0.12]")}>
                ‹ {monthLabel(prev).split(" ")[0]}
              </Link>
            ) : null}
            {next ? (
              <Link href={`/months/${next}`} className={cn(navCls, "hover:bg-hi/[0.12]")}>
                {monthLabel(next).split(" ")[0]} ›
              </Link>
            ) : null}
          </nav>
          {days.length > 0 && (
            <ButtonLink
              href={`/coach?q=${encodeURIComponent(`How did I trade in ${name}? What went well and what should I fix?`)}`}
              size="sm"
            >
              Ask coach about {name.split(" ")[0]}
            </ButtonLink>
          )}
        </div>
      </header>

      <MonthSummary days={all} month={month} detailed />

      {days.length > 0 && (
        <>
          <div className="grid items-start gap-6 xl:grid-cols-[1.15fr_1fr]">
            <Panel title="Calendar">
              <CalendarHeatmap months={[month]} days={all} today={today} weekTotals large />
            </Panel>
            <div className="grid gap-6">
              <Panel title="Profit and loss each day">
                <TimeSeriesChart
                  kind="daily"
                  height={200}
                  points={days.map((d) => ({ date: d.date, value: Number(d.pnl) }))}
                />
              </Panel>
              <Panel title="Running total this month">
                <TimeSeriesChart
                  kind="equity"
                  height={200}
                  points={rows.map((d) => ({ date: d.date, value: d.running }))}
                />
              </Panel>
            </div>
          </div>

          <Panel title="Day by day">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-rule text-left text-xs text-ink-muted">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Day
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Trades
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Won
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Win rate
                    </th>
                    <th scope="col" className="w-1/4 py-2 pr-3 font-medium">
                      <span className="sr-only">Size</span>
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      P&L
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Running total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => {
                    const v = Number(d.pnl);
                    const share = maxAbs ? (Math.abs(v) / maxAbs) * 50 : 0;
                    return (
                      <tr key={d.date} className="border-b border-rule/50 last:border-0">
                        <th scope="row" className="py-2.5 pr-3 text-left font-medium">
                          {rowDate.format(new Date(`${d.date}T00:00:00Z`))}
                        </th>
                        <td className="figures py-2.5 pr-3 text-right">{d.trades}</td>
                        <td className="figures py-2.5 pr-3 text-right text-ink-muted">
                          <span className="text-profit">{d.wins}</span> of {d.trades}
                        </td>
                        <td className="figures py-2.5 pr-3 text-right">
                          {formatPercent(d.trades ? d.wins / d.trades : null, 0)}
                        </td>
                        <td className="py-2.5 pr-3" aria-hidden="true">
                          <div className="relative h-2.5">
                            <span className="absolute inset-y-[-3px] left-1/2 w-px bg-rule" />
                            <span
                              className={cn(
                                "pop-bar absolute inset-y-0",
                                v >= 0
                                  ? "left-1/2 rounded-r-[5px] bg-profit"
                                  : "right-1/2 rounded-l-[5px] bg-loss",
                              )}
                              style={{ width: `${Math.max(share, 0.8)}%` }}
                            />
                          </div>
                        </td>
                        <td
                          className={cn(
                            "figures pop-text py-2.5 pr-3 text-right font-semibold",
                            v > 0 ? "text-profit" : v < 0 ? "text-loss" : "text-ink",
                          )}
                        >
                          {formatPnl(d.pnl)}
                        </td>
                        <td
                          className={cn(
                            "figures py-2.5 text-right",
                            d.running >= 0 ? "text-ink" : "text-loss",
                          )}
                        >
                          {formatPnl(d.running.toFixed(2))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
