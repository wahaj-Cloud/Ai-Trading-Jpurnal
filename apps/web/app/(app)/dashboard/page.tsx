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
import { PnlColumns } from "@/features/charts/pnl-columns";
import { TimeSeriesChart } from "@/features/charts/time-series-chart";
import { getBehaviour, getNotes } from "@/features/coach/load";
import { CoinBars, DirectionSplit, WinLossPanel } from "@/features/dashboard/balance-panels";
import { BestSession } from "@/features/dashboard/best-session";
import { CoachPanel } from "@/features/dashboard/coach-panel";
import {
  DailyWinCard,
  HourlyWinsLosses,
  StreakCard,
  SymbolsDonut,
  YearlyGrid,
} from "@/features/dashboard/insight-cards";
import { KpiBand } from "@/features/dashboard/kpi-band";
import { SessionClock } from "@/features/dashboard/session-clock";
import { SessionMap } from "@/features/dashboard/session-map";
import { SetupRunway } from "@/features/dashboard/setup-runway";
import { GoalRow, RiskBanner } from "@/features/goals/views";
import { MONTH_RE, shiftMonth } from "@/features/months/month-stats";
import { MonthSummary } from "@/features/months/month-summary";
import { getPositions } from "@/features/trades/load";
import { TradesTable } from "@/features/trades/trades-table";
import { apiFetch } from "@/lib/api";
import { getDisplay } from "@/lib/display";
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

function MonthNav({
  month,
  prev,
  next,
}: {
  month: string;
  prev: string | null;
  next: string | null;
}) {
  const cls = "rounded-md border border-rule px-2.5 py-1 text-sm";
  return (
    <nav aria-label={`Calendar month, showing ${month}`} className="flex items-center gap-2">
      {prev ? (
        <Link
          href={`/dashboard?month=${prev}`}
          className={`${cls} hover:bg-raised`}
          aria-label="Previous month"
          scroll={false}
        >
          ‹
        </Link>
      ) : (
        <span className={`${cls} text-ink-faint`} aria-hidden="true">
          ‹
        </span>
      )}
      {next ? (
        <Link
          href={`/dashboard?month=${next}`}
          className={`${cls} hover:bg-raised`}
          aria-label="Next month"
          scroll={false}
        >
          ›
        </Link>
      ) : (
        <span className={`${cls} text-ink-faint`} aria-hidden="true">
          ›
        </span>
      )}
    </nav>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;
  const [me, display] = await Promise.all([getMe(), getDisplay()]);
  const firstName = me.name?.split(" ")[0];
  const [report, open, recent, notes, habits, risk, goals] = await Promise.all([
    orNull<AnalyticsDto>(getAnalytics("all")),
    orNull<OpenPositionsDto>(getOpenPositions()),
    orNull<PositionsPage>(getPositions("status=CLOSED&sort=closed&limit=5")),
    orNull(getNotes(1)),
    orNull(getBehaviour(30)),
    orNull(apiFetch<RiskStatusDto>("/v1/risk-status")),
    orNull(apiFetch<GoalDto[]>("/v1/goals")),
  ]);
  const onboarded = Object.values(me.onboarding).every(Boolean);
  const hasTrades = (report?.summary.trades ?? 0) > 0;
  const today = report?.range.to ?? new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const firstMonth = report?.daily[0]?.date.slice(0, 7) ?? currentMonth;
  const month =
    monthParam &&
    MONTH_RE.test(monthParam) &&
    monthParam <= currentMonth &&
    monthParam >= firstMonth
      ? monthParam
      : currentMonth;
  const prevMonth = month > firstMonth ? shiftMonth(month, -1) : null;
  const nextMonth = month < currentMonth ? shiftMonth(month, 1) : null;

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {firstName ? `Welcome, ${firstName}` : "Welcome"}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Times and daily totals use {me.timezone}.
          {display.code !== "USD" && (
            <>
              {" "}
              Amounts in {display.code} at today's rate (1 USD ={" "}
              {display.rate.toLocaleString("en", { maximumFractionDigits: 2 })} {display.code}).
            </>
          )}
          {display.unavailable && (
            <> No rate for {display.unavailable} yet, so amounts show in USD.</>
          )}
          {me.timezone === "UTC" && (
            <>
              {" "}
              <Link href="/settings" className="text-coach underline-offset-4 hover:underline">
                Set your own timezone
              </Link>{" "}
              so sessions and days match your clock.
            </>
          )}
        </p>
      </header>
      {!onboarded && <SetupRunway onboarding={me.onboarding} />}
      <RiskBanner status={risk} />
      <div className="grid items-stretch gap-6 xl:grid-cols-[1fr_26rem]">
        <Panel title="Market sessions">
          <SessionClock timeZone={me.timezone} />
        </Panel>
        <Panel
          title="Your best session"
          action={hasTrades ? <PanelLink href="/analytics">Details</PanelLink> : undefined}
        >
          <BestSession bySession={report?.bySession ?? []} timeZone={me.timezone} />
        </Panel>
      </div>
      <KpiBand report={report} />

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <Panel
          title="Equity curve"
          action={hasTrades ? <PanelLink href="/analytics">Full analytics</PanelLink> : undefined}
        >
          {hasTrades && report ? (
            <TimeSeriesChart
              kind="equity"
              height={300}
              points={report.daily.map((d) => ({ date: d.date, value: Number(d.cumulative) }))}
            />
          ) : (
            <p className="text-sm text-ink-muted">
              Your cumulative profit appears here, day by day, once trades close.
            </p>
          )}
        </Panel>
        <Panel title="Wins and losses">
          {hasTrades && report ? (
            <WinLossPanel s={report.summary} />
          ) : (
            <p className="text-sm text-ink-muted">
              Your win rate and average win/loss appear here.
            </p>
          )}
        </Panel>
      </div>

      {hasTrades && report && (
        <Panel
          title="Trading sessions"
          action={<PanelLink href="/analytics">By weekday and coin</PanelLink>}
        >
          <SessionMap
            bySession={report.bySession}
            byHour={report.byHour}
            timeZone={report.range.timezone}
          />
        </Panel>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_24rem]">
        <Panel
          title={month === currentMonth ? "This month" : "Calendar"}
          action={
            <div className="flex items-center gap-3">
              {hasTrades && <PanelLink href={`/months/${month}`}>Full month</PanelLink>}
              <MonthNav month={month} prev={prevMonth} next={nextMonth} />
            </div>
          }
        >
          <div className="grid gap-5">
            <CalendarHeatmap
              months={[month]}
              days={report?.daily ?? []}
              today={today}
              weekTotals
              large
              monthHref={hasTrades ? (m) => `/months/${m}` : undefined}
            />
            {hasTrades && <MonthSummary days={report?.daily ?? []} month={month} />}
          </div>
        </Panel>
        <CoachPanel note={notes?.[0] ?? null} habits={habits} />
      </div>

      {hasTrades && report && (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            <Panel title="Streaks">
              <StreakCard report={report} />
            </Panel>
            <Panel title="Winning days">
              <DailyWinCard days={report.daily} />
            </Panel>
            <Panel title="Symbols traded">
              <SymbolsDonut buckets={report.bySymbol} />
            </Panel>
          </div>
          <Panel title="Net daily P&L">
            <TimeSeriesChart
              kind="daily"
              height={220}
              points={report.daily.map((d) => ({ date: d.date, value: Number(d.pnl) }))}
            />
          </Panel>
          <Panel title="Trade distribution by hour">
            <HourlyWinsLosses buckets={report.byHour} />
          </Panel>
        </>
      )}

      {hasTrades && report && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Panel title="Coins" action={<PanelLink href="/analytics">All coins</PanelLink>}>
            <CoinBars buckets={report.bySymbol} />
          </Panel>
          <Panel title="Long vs short">
            <DirectionSplit buckets={report.byDirection} />
          </Panel>
          <Panel title="By weekday">
            <PnlColumns
              title="Net P&L by the day you opened"
              buckets={report.byWeekday}
              height={150}
            />
          </Panel>
        </div>
      )}

      {hasTrades && report && report.monthly.length > 0 && (
        <Panel title="Yearly performance">
          <YearlyGrid months={report.monthly} />
        </Panel>
      )}

      <Panel title="Open positions" action={<PanelLink href="/trades?view=open">All</PanelLink>}>
        {open ? (
          <OpenPositionsTable data={open} compact />
        ) : (
          <p className="text-sm text-ink-muted">Live positions could not be loaded.</p>
        )}
      </Panel>

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
