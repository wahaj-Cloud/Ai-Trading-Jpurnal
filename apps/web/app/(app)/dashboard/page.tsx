import {
  type AnalyticsDto,
  type DashboardWidgetId,
  deskSymbolOf,
  GoalDto,
  type MarketBiasDto,
  type MarketOverviewDto,
  OpenPositionsDto,
  PositionsPage,
  RiskStatusDto,
  type TradeCheckResponse,
} from "@atc/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import { getAnalytics, getOpenPositions } from "@/features/analytics/load";
import { Panel } from "@/features/analytics/metric";
import { OpenPositionsTable } from "@/features/analytics/open-positions-table";
import { FoundingBadge } from "@/features/billing/founding-badge";
import { CalendarHeatmap } from "@/features/charts/calendar-heatmap";
import { PnlColumns } from "@/features/charts/pnl-columns";
import { TimeSeriesChart } from "@/features/charts/time-series-chart";
import { TradeCheckWidget } from "@/features/check/widget";
import { getBehaviour, getNotes, getPsychology } from "@/features/coach/load";
import { buildRecommendations, MIN_TRADES_FOR_ADVICE } from "@/features/coach/recommendations";
import { RecommendationsList } from "@/features/coach/recommendations-card";
import { CoinBars, DirectionSplit, WinLossPanel } from "@/features/dashboard/balance-panels";
import { BestSession } from "@/features/dashboard/best-session";
import { DashboardBoard } from "@/features/dashboard/board";
import { CoachPanel } from "@/features/dashboard/coach-panel";
import {
  DailyWinCard,
  HourlyWinsLosses,
  StreakCard,
  SymbolsDonut,
  YearlyGrid,
} from "@/features/dashboard/insight-cards";
import { KpiBand } from "@/features/dashboard/kpi-band";
import { MarketFlowWidget } from "@/features/dashboard/market-flow-widget";
import { MarketOverview } from "@/features/dashboard/market-overview";
import { PsychologyPanel } from "@/features/dashboard/psychology-panel";
import { SessionClock } from "@/features/dashboard/session-clock";
import { SessionMap } from "@/features/dashboard/session-map";
import { SetupRunway } from "@/features/dashboard/setup-runway";
import { GoalRow, RiskBanner } from "@/features/goals/views";
import { MONTH_RE, shiftMonth } from "@/features/months/month-stats";
import { MonthSummary } from "@/features/months/month-summary";
import { getCalendar } from "@/features/news/load";
import { NewsAlert } from "@/features/news/news-alert";
import { UpcomingNews } from "@/features/news/upcoming-news";
import { getPositions } from "@/features/trades/load";
import { TradesTable } from "@/features/trades/trades-table";
import { apiFetch } from "@/lib/api";
import { getDisplay } from "@/lib/display";
import { getMe } from "@/lib/me";

export const metadata = { title: "Dashboard" };

/** A panel failing to load should not take the whole dashboard down. */
const orNull = <T,>(p: Promise<T>) => p.catch(() => null);

/**
 * Trade Check for the market the trader last traded (Bitcoin when none, or when the plan does not
 * include that market).
 */
async function loadTradeCheck(lastSymbol: string | undefined) {
  const preferred = (lastSymbol && deskSymbolOf(lastSymbol)) || "BTCUSDT";
  const res = await apiFetch<TradeCheckResponse>(`/v1/market/check?symbol=${preferred}`);
  if (res.status === "ok") return res.check;
  if (res.status === "locked" && preferred !== "BTCUSDT") {
    const btc = await apiFetch<TradeCheckResponse>("/v1/market/check?symbol=BTCUSDT");
    return btc.status === "ok" ? btc.check : null;
  }
  return null;
}

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
  const newsFrom = new Date();
  const [report, open, recent, notes, habits, risk, goals, news, overview, psychology, flow] =
    await Promise.all([
      orNull<AnalyticsDto>(getAnalytics("all")),
      orNull<OpenPositionsDto>(getOpenPositions()),
      orNull<PositionsPage>(getPositions("status=CLOSED&sort=closed&limit=5")),
      orNull(getNotes(1)),
      orNull(getBehaviour(30)),
      orNull(apiFetch<RiskStatusDto>("/v1/risk-status")),
      orNull(apiFetch<GoalDto[]>("/v1/goals")),
      orNull(
        getCalendar({
          // Include the last hour so a release that just came out is still listed.
          from: new Date(newsFrom.getTime() - 3_600_000),
          to: new Date(newsFrom.getTime() + 48 * 3_600_000),
          impact: ["HIGH", "MEDIUM"],
        }),
      ),
      orNull(apiFetch<MarketOverviewDto>("/v1/market/overview")),
      orNull(getPsychology(30)),
      orNull(apiFetch<MarketBiasDto>("/v1/market/bias")),
    ]);
  const tradeCheck = await orNull(loadTradeCheck(recent?.items[0]?.symbol));
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

  const recommendations = buildRecommendations(report, habits, 4);
  const showRecommendations = (report?.summary.trades ?? 0) >= MIN_TRADES_FOR_ADVICE;

  /** Each dashboard widget; null when it has nothing to show yet (e.g. before the first trade). */
  const widgets: Partial<Record<DashboardWidgetId, ReactNode>> = {
    "market-overview":
      overview && (overview.marketCap || overview.fearGreed || overview.altcoinSeason) ? (
        <MarketOverview initial={overview} />
      ) : null,
    "market-flow": flow && flow.items.length > 0 ? <MarketFlowWidget data={flow} /> : null,
    "trade-check": tradeCheck ? <TradeCheckWidget check={tradeCheck} /> : null,
    "market-sessions": (
      <Panel title="Market sessions">
        <SessionClock timeZone={me.timezone} />
      </Panel>
    ),
    "best-session": (
      <Panel
        title="Your best session"
        action={hasTrades ? <PanelLink href="/analytics">Details</PanelLink> : undefined}
      >
        <BestSession bySession={report?.bySession ?? []} timeZone={me.timezone} />
      </Panel>
    ),
    kpis: <KpiBand report={report} />,
    psychology: hasTrades && psychology ? <PsychologyPanel report={psychology} /> : null,
    recommendations: showRecommendations ? (
      <Panel
        title="Recommended improvements"
        action={<PanelLink href="/coach">Ask your coach</PanelLink>}
      >
        <RecommendationsList items={recommendations} columns />
      </Panel>
    ) : null,
    equity: (
      <Panel
        title="Equity curve"
        action={hasTrades ? <PanelLink href="/analytics">Full analytics</PanelLink> : undefined}
      >
        {hasTrades && report ? (
          <TimeSeriesChart
            currency={report.currency}
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
    ),
    "wins-losses": (
      <Panel title="Wins and losses">
        {hasTrades && report ? (
          <WinLossPanel s={report.summary} />
        ) : (
          <p className="text-sm text-ink-muted">Your win rate and average win/loss appear here.</p>
        )}
      </Panel>
    ),
    sessions:
      hasTrades && report ? (
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
      ) : null,
    calendar: (
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
    ),
    coach: <CoachPanel note={notes?.[0] ?? null} habits={habits} />,
    streaks:
      hasTrades && report ? (
        <Panel title="Streaks">
          <StreakCard report={report} />
        </Panel>
      ) : null,
    "winning-days":
      hasTrades && report ? (
        <Panel title="Winning days">
          <DailyWinCard days={report.daily} />
        </Panel>
      ) : null,
    symbols:
      hasTrades && report ? (
        <Panel title="Symbols traded">
          <SymbolsDonut buckets={report.bySymbol} />
        </Panel>
      ) : null,
    "daily-pnl":
      hasTrades && report ? (
        <Panel title="Net daily P&L">
          <TimeSeriesChart
            currency={report.currency}
            kind="daily"
            height={220}
            points={report.daily.map((d) => ({ date: d.date, value: Number(d.pnl) }))}
          />
        </Panel>
      ) : null,
    "economic-calendar": (
      <Panel title="Upcoming news" action={<PanelLink href="/news">Economic calendar</PanelLink>}>
        {news ? (
          <UpcomingNews events={news.events} timeZone={me.timezone} />
        ) : (
          <p className="text-sm text-ink-muted">The economic calendar could not be loaded.</p>
        )}
      </Panel>
    ),
    hourly:
      hasTrades && report ? (
        <Panel title="Trade distribution by hour">
          <HourlyWinsLosses buckets={report.byHour} />
        </Panel>
      ) : null,
    coins:
      hasTrades && report ? (
        <Panel title="Coins" action={<PanelLink href="/analytics">All coins</PanelLink>}>
          <CoinBars buckets={report.bySymbol} />
        </Panel>
      ) : null,
    "long-short":
      hasTrades && report ? (
        <Panel title="Long vs short">
          <DirectionSplit buckets={report.byDirection} />
        </Panel>
      ) : null,
    weekday:
      hasTrades && report ? (
        <Panel title="By weekday">
          <PnlColumns
            title="Net P&L by the day you opened"
            buckets={report.byWeekday}
            height={150}
          />
        </Panel>
      ) : null,
    yearly:
      hasTrades && report && report.monthly.length > 0 ? (
        <Panel title="Yearly performance">
          <YearlyGrid months={report.monthly} />
        </Panel>
      ) : null,
    "open-positions": (
      <Panel title="Open positions" action={<PanelLink href="/trades?view=open">All</PanelLink>}>
        {open ? (
          <OpenPositionsTable data={open} compact />
        ) : (
          <p className="text-sm text-ink-muted">Live positions could not be loaded.</p>
        )}
      </Panel>
    ),
    goals:
      goals && goals.length > 0 ? (
        <Panel title="Goals" action={<PanelLink href="/goals">Manage</PanelLink>}>
          <ul className="grid gap-3 md:grid-cols-2">
            {goals.map((g) => (
              <GoalRow key={g.id} goal={g} />
            ))}
          </ul>
        </Panel>
      ) : null,
    "latest-trades":
      recent && recent.items.length > 0 ? (
        <Panel title="Latest trades" action={<PanelLink href="/trades">All trades</PanelLink>}>
          <TradesTable items={recent.items} timezone={me.timezone} bare />
        </Panel>
      ) : null,
  };

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <DashboardBoard
        layout={me.settings.dashboardLayout}
        widgets={widgets}
        header={
          <div>
            <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
              {firstName ? `Welcome, ${firstName}` : "Welcome"}
              {me.foundingMember && <FoundingBadge />}
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
          </div>
        }
        notices={
          <>
            {!onboarded && <SetupRunway onboarding={me.onboarding} />}
            <RiskBanner status={risk} />
            <NewsAlert events={news?.events ?? []} />
          </>
        }
      />
    </div>
  );
}
