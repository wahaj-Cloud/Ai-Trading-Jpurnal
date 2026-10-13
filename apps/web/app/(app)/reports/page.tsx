import { REPORT_PERIODS, type ReportDto, type ReportPeriod } from "@atc/shared";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Panel } from "@/features/analytics/metric";
import { SummaryGrid } from "@/features/analytics/summary-grid";
import { TimeSeriesChart } from "@/features/charts/time-series-chart";
import { Habits } from "@/features/coach/habits";
import { NoteCard } from "@/features/coach/note-card";
import { TradesTable } from "@/features/trades/trades-table";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getMe } from "@/lib/me";

export const metadata = { title: "Reports" };

const LABEL: Record<ReportPeriod, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  year: "Yearly",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; date?: string }>;
}) {
  const params = await searchParams;
  const period = (REPORT_PERIODS as readonly string[]).includes(params.period ?? "")
    ? (params.period as ReportPeriod)
    : "week";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "") ? params.date : undefined;
  const q = new URLSearchParams({ period, ...(date ? { date } : {}) });
  const [report, me] = await Promise.all([apiFetch<ReportDto>(`/v1/reports?${q}`), getMe()]);
  const href = (p: ReportPeriod, d?: string) => `/reports?period=${p}${d ? `&date=${d}` : ""}`;
  const download = (kind: string, extra: Record<string, string>) =>
    `/reports/download?${new URLSearchParams({ kind, ...extra })}`;
  const s = report.analytics.summary;

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Daily, weekly, monthly and yearly results, ready to download.
          </p>
        </div>
        <nav aria-label="Report period" className="flex gap-1">
          {REPORT_PERIODS.map((p) => (
            <Link
              key={p}
              href={href(p, date)}
              aria-current={p === period ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                p === period
                  ? "border-coach text-ink"
                  : "border-rule text-ink-muted hover:text-ink",
              )}
            >
              {LABEL[p]}
            </Link>
          ))}
        </nav>
      </header>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-surface)] surface px-4 py-3">
        <div className="flex items-center gap-2">
          <Link
            href={href(period, report.previous)}
            aria-label="Previous period"
            className={buttonClass("ghost", "sm")}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <h2 className="font-semibold">{report.label}</h2>
          {report.next ? (
            <Link
              href={href(period, report.next)}
              aria-label="Next period"
              className={buttonClass("ghost", "sm")}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : (
            <span className={cn(buttonClass("ghost", "sm"), "opacity-30")} aria-hidden="true">
              <ChevronRight className="h-4 w-4" />
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={download("pdf", { period, date: report.from })}
            className={buttonClass("primary", "sm")}
          >
            <Download className="h-4 w-4" aria-hidden="true" /> PDF report
          </a>
          <a
            href={download("xlsx", { from: report.from, to: report.to })}
            className={buttonClass("secondary", "sm")}
          >
            Excel
          </a>
          <a
            href={download("csv", { from: report.from, to: report.to })}
            className={buttonClass("secondary", "sm")}
          >
            CSV
          </a>
        </div>
      </section>

      {s.trades === 0 ? (
        <p className="rounded-[var(--radius-surface)] surface p-8 text-center text-sm text-ink-muted">
          No closed trades in this period.
        </p>
      ) : (
        <>
          <SummaryGrid s={s} />
          {report.period !== "day" && report.analytics.daily.length > 1 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Panel title="Equity">
                <TimeSeriesChart
                  kind="equity"
                  points={report.analytics.daily.map((d) => ({
                    date: d.date,
                    value: Number(d.cumulative),
                  }))}
                />
              </Panel>
              <Panel title="Daily P&L">
                <TimeSeriesChart
                  kind="daily"
                  points={report.analytics.daily.map((d) => ({
                    date: d.date,
                    value: Number(d.pnl),
                  }))}
                />
              </Panel>
            </div>
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Best trades">
              {report.bestTrades.length ? (
                <TradesTable items={report.bestTrades} timezone={me.timezone} bare compact />
              ) : (
                <p className="text-sm text-ink-muted">No winning trades.</p>
              )}
            </Panel>
            <Panel title="Worst trades">
              {report.worstTrades.length ? (
                <TradesTable items={report.worstTrades} timezone={me.timezone} bare compact />
              ) : (
                <p className="text-sm text-ink-muted">No losing trades.</p>
              )}
            </Panel>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Behaviours">
              <Habits summary={report.behaviour} />
            </Panel>
            <Panel title="Coaching notes">
              {report.notes.length ? (
                <div className="grid gap-6">
                  {report.notes.map((n) => (
                    <NoteCard key={n.id} note={n} compact />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-muted">No coaching notes for this period.</p>
              )}
            </Panel>
          </div>
        </>
      )}

      <Panel title="Export all trades">
        <p className="mb-3 text-sm text-ink-muted">
          Every closed trade with its journal (setup, rating, emotions, mistakes, notes), for your
          own records or your accountant.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={download("xlsx", {})} className={buttonClass("secondary", "sm")}>
            All trades (Excel)
          </a>
          <a href={download("csv", {})} className={buttonClass("secondary", "sm")}>
            All trades (CSV)
          </a>
        </div>
      </Panel>
    </div>
  );
}
