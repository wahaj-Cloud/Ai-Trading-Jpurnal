import type {
  AnalyticsDto,
  GoalDto,
  OpenPositionsDto,
  PositionsPage,
  RiskStatusDto,
} from "@atc/shared";
import Link from "next/link";
import { getAnalytics, getOpenPositions } from "@/features/analytics/load";
import { Panel } from "@/features/analytics/metric";
import { OpenPositionsTable } from "@/features/analytics/open-positions-table";
import { CalendarHeatmap } from "@/features/charts/calendar-heatmap";
import { TimeSeriesChart } from "@/features/charts/time-series-chart";
import { getBehaviour, getNotes } from "@/features/coach/load";
import { CoachPanel } from "@/features/dashboard/coach-panel";
import { KpiBand } from "@/features/dashboard/kpi-band";
import { SetupRunway } from "@/features/dashboard/setup-runway";
import { GoalRow, RiskBanner } from "@/features/goals/views";
import { TradesTable } from "@/features/trades/trades-table";
import { apiFetch } from "@/lib/api";
import { getMe } from "@/lib/me";

export const metadata = { title: "Dashboard" };

/** A panel failing to load should not take the whole dashboard down. */
const orNull = <T,>(p: Promise<T>) => p.catch(() => null);

const PanelLink = ({ href, children }: { href: string; children: string }) => (
  <Link
    href={href}
    className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
  >
    {children}
  </Link>
);

export default async function DashboardPage() {
  const me = await getMe();
  const firstName = me.name?.split(" ")[0];
  const [report, open, recent, notes, habits, risk, goals] = await Promise.all([
    orNull<AnalyticsDto>(getAnalytics("all")),
    orNull<OpenPositionsDto>(getOpenPositions()),
    orNull<PositionsPage>(
      apiFetch<PositionsPage>("/v1/positions?status=CLOSED&sort=closed&limit=5"),
    ),
    orNull(getNotes(1)),
    orNull(getBehaviour(30)),
    orNull(apiFetch<RiskStatusDto>("/v1/risk-status")),
    orNull(apiFetch<GoalDto[]>("/v1/goals")),
  ]);
  const onboarded = Object.values(me.onboarding).every(Boolean);
  const hasTrades = (report?.summary.trades ?? 0) > 0;
  const today = report?.range.to ?? new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {firstName ? `Welcome, ${firstName}` : "Welcome"}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">Times and daily totals use {me.timezone}.</p>
      </header>
      {!onboarded && <SetupRunway onboarding={me.onboarding} />}
      <RiskBanner status={risk} />
      <KpiBand report={report} />

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <Panel
          title="Equity curve"
          action={hasTrades ? <PanelLink href="/analytics">Full analytics</PanelLink> : undefined}
        >
          {hasTrades && report ? (
            <TimeSeriesChart
              kind="equity"
              points={report.daily.map((d) => ({ date: d.date, value: Number(d.cumulative) }))}
            />
          ) : (
            <p className="text-sm text-ink-muted">
              Your cumulative profit appears here, day by day, once trades close.
            </p>
          )}
        </Panel>
        <Panel title="Open positions" action={<PanelLink href="/trades?view=open">All</PanelLink>}>
          {open ? (
            <OpenPositionsTable data={open} compact />
          ) : (
            <p className="text-sm text-ink-muted">Live positions could not be loaded.</p>
          )}
        </Panel>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_24rem]">
        <Panel title="This month">
          <CalendarHeatmap months={[today.slice(0, 7)]} days={report?.daily ?? []} today={today} />
        </Panel>
        <CoachPanel note={notes?.[0] ?? null} habits={habits} />
      </div>

      {goals && goals.length > 0 && (
        <Panel title="Goals" action={<PanelLink href="/goals">Manage</PanelLink>}>
          <ul className="grid gap-3 md:grid-cols-2">
            {goals.map((g) => (
              <GoalRow key={g.id} goal={g} />
            ))}
          </ul>
        </Panel>
      )}

      {recent && recent.items.length > 0 && (
        <Panel title="Latest trades" action={<PanelLink href="/trades">All trades</PanelLink>}>
          <TradesTable items={recent.items} timezone={me.timezone} bare />
        </Panel>
      )}
    </div>
  );
}
