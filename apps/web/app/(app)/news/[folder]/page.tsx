import { type EconomicEventDto, NEWS_CATEGORY_INFO, type NewsPageDto } from "@atc/shared";
import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Panel } from "@/features/analytics/metric";
import { CENTRAL_BANK_EVENT } from "@/features/news/central-banks";
import { Countdown } from "@/features/news/countdown";
import { CurrencyFlag } from "@/features/news/currency-flag";
import { HeadlineFeed, type ImpactFilter, type NewsFolder } from "@/features/news/headlines";
import { getCalendar } from "@/features/news/load";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

const FOLDERS: Record<string, { folder: NewsFolder; title: string; intro: string }> = {
  top: {
    folder: "top",
    title: "Top stories",
    intro:
      "Every high-impact headline from all folders in one place: wars, pandemics, central-bank decisions, crises, crypto shocks and big economic surprises. New ones appear here and pop up on every page the moment they are published.",
  },
  world: {
    folder: "world",
    title: NEWS_CATEGORY_INFO.world.label,
    intro: `${NEWS_CATEGORY_INFO.world.about} The kind of news that sent markets down in March 2020 or February 2022.`,
  },
  "central-banks": {
    folder: "central-banks",
    title: NEWS_CATEGORY_INFO["central-banks"].label,
    intro: `${NEWS_CATEGORY_INFO["central-banks"].about} Official releases straight from the Federal Reserve and the ECB, plus newsroom coverage.`,
  },
  crypto: {
    folder: "crypto",
    title: "Crypto news",
    intro: NEWS_CATEGORY_INFO.crypto.about,
  },
  markets: {
    folder: "markets",
    title: "Markets & companies",
    intro: NEWS_CATEGORY_INFO.markets.about,
  },
};

const IMPACT_FILTERS: Array<{ id: ImpactFilter; label: string }> = [
  { id: "ALL", label: "All" },
  { id: "MEDIUM", label: "Medium and high" },
  { id: "HIGH", label: "High only" },
];

type Props = {
  params: Promise<{ folder: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props) {
  const f = FOLDERS[(await params).folder];
  return { title: f ? f.title : "News" };
}

export default async function NewsFolderPage({ params, searchParams }: Props) {
  const { folder: slug } = await params;
  const f = FOLDERS[slug];
  if (!f) notFound();
  const raw = await searchParams;
  const impact: ImpactFilter =
    f.folder === "top"
      ? "HIGH"
      : raw.impact === "HIGH" || raw.impact === "MEDIUM"
        ? raw.impact
        : f.folder === "markets"
          ? "MEDIUM"
          : "ALL";
  const q = new URLSearchParams({ folder: f.folder, impact, limit: "40" });
  const now = new Date();
  const [page, calendar] = await Promise.all([
    apiFetch<NewsPageDto>(`/v1/news?${q}`).catch(() => null),
    f.folder === "central-banks"
      ? getCalendar({
          from: now,
          to: new Date(now.getTime() + 45 * 86_400_000),
          impact: ["HIGH"],
        }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const decisions: EconomicEventDto[] = (calendar?.events ?? [])
    .filter((e) => CENTRAL_BANK_EVENT.test(e.title))
    .slice(0, 8);

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{f.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">{f.intro}</p>
      </header>

      {f.folder === "central-banks" && (
        <Panel
          title="Upcoming central-bank decisions"
          action={
            <Link href="/news" className="text-sm text-ink-muted hover:text-ink">
              Full calendar
            </Link>
          }
        >
          {decisions.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No high-impact central-bank events in the next 45 days.
            </p>
          ) : (
            <ul className="grid divide-y divide-rule">
              {decisions.map((e, i) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <CurrencyFlag currency={e.currency} />
                    <span className="font-medium">{e.title}</span>
                  </span>
                  <span className="flex items-center gap-3 text-xs text-ink-muted">
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                    {new Date(e.startsAt).toUTCString().slice(0, 22)} UTC
                    {i === 0 && (
                      <Countdown to={e.startsAt} className="figures font-semibold text-[#f5b84d]" />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {f.folder !== "top" && (
        <nav aria-label="Impact" className="flex flex-wrap gap-2">
          {IMPACT_FILTERS.map((x) => (
            <Link
              key={x.id}
              href={x.id === "ALL" ? `/news/${slug}?impact=ALL` : `/news/${slug}?impact=${x.id}`}
              scroll={false}
              aria-current={impact === x.id ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3 text-sm",
                impact === x.id
                  ? "border-coach/60 bg-coach/15 font-medium text-ink"
                  : "border-rule text-ink-muted hover:bg-hi/[0.06] hover:text-ink",
              )}
            >
              {x.label}
            </Link>
          ))}
        </nav>
      )}

      <Panel title={f.folder === "top" ? "High-impact, newest first" : "Latest"}>
        {page ? (
          <HeadlineFeed
            key={`${f.folder}:${impact}`}
            folder={f.folder}
            impact={impact}
            initial={page.items}
            nextCursor={page.nextCursor}
            renderedAt={Date.now()}
          />
        ) : (
          <p className="text-sm text-ink-muted">The news could not be loaded. Try again shortly.</p>
        )}
      </Panel>

      <p className="text-xs text-ink-faint">
        Headlines from Finnhub (Reuters, CNBC, MarketWatch and others), the Federal Reserve and ECB,
        GDELT and Trading Economics. Impact is rated by fixed rules (for example war, pandemic, rate
        decision, exchange hack = High). “Market after” shows how Bitcoin and gold actually moved;
        it is a record, not a forecast.
      </p>
    </div>
  );
}
