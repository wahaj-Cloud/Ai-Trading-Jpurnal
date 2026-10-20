import {
  CALENDAR_CURRENCIES,
  type EconomicCalendarDto,
  IMPACTS,
  type NewsPageDto,
} from "@atc/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import { Panel } from "@/features/analytics/metric";
import {
  DEFAULT_IMPACTS,
  groupByDay,
  newsHref,
  nextEvent,
  parseNewsFilters,
  toggle,
} from "@/features/news/calendar-view";
import { Countdown } from "@/features/news/countdown";
import { CurrencyFlag } from "@/features/news/currency-flag";
import { EventTable } from "@/features/news/event-table";
import { HeadlineFeed } from "@/features/news/headlines";
import { IMPACT_STYLE, ImpactBadge } from "@/features/news/impact";
import { getCalendar } from "@/features/news/load";
import { NewsAlert } from "@/features/news/news-alert";
import { RANGE_PRESETS, rangeFor } from "@/features/news/ranges";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getMe } from "@/lib/me";

export const metadata = { title: "Economic calendar" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function Chip({
  href,
  active,
  children,
  label,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
  label?: string;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap transition-colors",
        active
          ? "border-coach/60 bg-coach/15 font-medium text-ink shadow-[0_0_0_1px_var(--color-coach)_inset]"
          : "border-rule text-ink-muted hover:bg-hi/[0.06] hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

function FilterRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 md:grid-cols-[7rem_1fr] md:items-center">
      <span className="text-xs font-medium tracking-wide text-ink-faint uppercase">{title}</span>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible md:pb-0">
        {children}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="surface rounded-[var(--radius-surface)] p-4">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="figures pop-text mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

/** Economic calendar: market-moving news by day, filtered by impact, currency and date range. */
export default async function NewsPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, me] = await Promise.all([searchParams, getMe()]);
  const f = parseNewsFilters(params);
  const timeZone = f.tz === "utc" ? "UTC" : me.timezone;
  const now = new Date();
  const { from, to } = rangeFor(f.range, timeZone, now);
  const [data, economyNews] = await Promise.all([
    getCalendar({
      from,
      to,
      impact: f.impact,
      currency: f.currency,
    }).catch((): EconomicCalendarDto | null => null),
    apiFetch<NewsPageDto>("/v1/news?folder=economy&impact=MEDIUM&limit=15").catch(() => null),
  ]);

  const events = data?.events ?? [];
  const days = groupByDay(events, timeZone, now);
  const next = nextEvent(events, now);
  const high = events.filter((e) => e.impact === "HIGH").length;
  const upcoming = events.filter((e) => new Date(e.startsAt).getTime() >= now.getTime()).length;
  const currencies = new Set(events.map((e) => e.currency)).size;
  const allCurrencies = f.currency.length === 0;
  const tzName = timeZone === "UTC" ? "UTC" : timeZone.replace(/_/g, " ");
  const timeFmt = new Intl.DateTimeFormat("en", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Economic calendar</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            News that moves markets: interest rate decisions, inflation, jobs and central bank
            speeches. Crypto and gold often move hard on red (high impact) USD releases. Each
            release shows how markets usually react if the number comes in above or below the
            forecast.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-ink-faint">Times in</span>
          <Chip href={newsHref(f, { tz: "local" })} active={f.tz === "local"}>
            {me.timezone === "UTC"
              ? "My time (UTC)"
              : me.timezone.split("/").pop()?.replace(/_/g, " ")}
          </Chip>
          <Chip href={newsHref(f, { tz: "utc" })} active={f.tz === "utc"}>
            UTC
          </Chip>
        </div>
      </header>

      <NewsAlert events={events} />

      <section
        aria-label="Filters"
        className="surface grid gap-4 rounded-[var(--radius-surface)] p-5"
      >
        <FilterRow title="Date">
          {RANGE_PRESETS.map((r) => (
            <Chip key={r.id} href={newsHref(f, { range: r.id })} active={f.range === r.id}>
              {r.label}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow title="Impact">
          {IMPACTS.map((i) => (
            <Chip
              key={i}
              href={newsHref(f, { impact: toggle(f.impact, i, DEFAULT_IMPACTS) })}
              active={f.impact.includes(i)}
              label={`${IMPACT_STYLE[i].label} impact`}
            >
              <ImpactBadge impact={i} />
            </Chip>
          ))}
        </FilterRow>
        <FilterRow title="Currency">
          <Chip href={newsHref(f, { currency: [] })} active={allCurrencies}>
            All
          </Chip>
          {CALENDAR_CURRENCIES.map((c) => (
            <Chip
              key={c}
              href={newsHref(f, { currency: allCurrencies ? [c] : toggle(f.currency, c) })}
              active={f.currency.includes(c)}
            >
              <CurrencyFlag currency={c} />
              {c}
            </Chip>
          ))}
        </FilterRow>
      </section>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Events"
          value={events.length}
          hint={RANGE_PRESETS.find((r) => r.id === f.range)?.label}
        />
        <Stat
          label="High impact"
          value={<span className={high > 0 ? "text-loss" : undefined}>{high}</span>}
          hint="Expect sharp moves"
        />
        <Stat
          label="Still to come"
          value={upcoming}
          hint={`${currencies} ${currencies === 1 ? "currency" : "currencies"}`}
        />
        <Stat
          label="Next release"
          value={next ? <Countdown to={next.startsAt} /> : "—"}
          hint={next ? `${next.currency} · ${next.title}` : "Nothing scheduled in this range"}
        />
      </div>

      <Panel
        title="Calendar"
        action={<span className="text-xs text-ink-faint">Times in {tzName}</span>}
      >
        {data === null ? (
          <p className="text-sm text-ink-muted">
            The calendar could not be loaded right now. Please try again in a minute.
          </p>
        ) : days.length === 0 ? (
          <div className="grid justify-items-start gap-2 text-sm text-ink-muted">
            <p>No events match these filters.</p>
            {(f.range === "next-week" || f.range === "this-month") && (
              <p>
                Next week's calendar is usually published over the weekend. Past weeks fill in as
                the calendar builds up history.
              </p>
            )}
            <Link href="/news" className="text-coach underline-offset-4 hover:underline">
              Reset filters
            </Link>
          </div>
        ) : (
          <EventTable
            days={days}
            timeZone={timeZone}
            nextId={next?.id ?? null}
            now={now.getTime()}
          />
        )}
      </Panel>

      <Panel
        title="Economy headlines"
        action={<span className="text-xs text-ink-faint">Medium and high impact, live</span>}
      >
        {economyNews ? (
          <HeadlineFeed
            folder="economy"
            impact="MEDIUM"
            initial={economyNews.items}
            nextCursor={economyNews.nextCursor}
            renderedAt={Date.now()}
            compact
          />
        ) : (
          <p className="text-sm text-ink-muted">Headlines could not be loaded.</p>
        )}
      </Panel>

      <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-faint">
        <p>
          {data?.fetchedAt ? <>Updated {ago(data.fetchedAt, now.getTime())} · </> : null}
          Source:{" "}
          <a
            href={data?.source.url ?? "https://www.forexfactory.com/calendar"}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-4 hover:text-ink hover:underline"
          >
            {data?.source.name ?? "Forex Factory"}
          </a>
          . Schedule refreshed every hour.{" "}
          {data?.live
            ? "Actual figures for live-covered releases (US CPI, PPI and the jobs report) are pushed here within seconds."
            : "Live actual figures are not switched on yet."}
        </p>
        {next && (
          <p>
            Next: {next.currency} {next.title} at {timeFmt.format(new Date(next.startsAt))}
          </p>
        )}
      </footer>
    </div>
  );
}
