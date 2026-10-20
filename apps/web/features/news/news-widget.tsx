import type { EconomicEventDto, NewsItemDto } from "@atc/shared";
import Link from "next/link";
import { Panel } from "@/features/analytics/metric";
import { Countdown } from "./countdown";
import { CurrencyFlag } from "./currency-flag";
import { HeadlineFeed } from "./headlines";

/** Dashboard: the latest high-impact headlines (live) beside the next high-impact releases. */
export function HighImpactNewsWidget({
  headlines,
  upcoming,
}: {
  headlines: NewsItemDto[];
  upcoming: EconomicEventDto[];
}) {
  const next = upcoming[0];
  return (
    <Panel
      title="High-impact news"
      action={
        <Link
          href="/news/top"
          className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Top stories
        </Link>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <HeadlineFeed
          folder="top"
          impact="HIGH"
          initial={headlines}
          nextCursor={null}
          compact
          limit={6}
          renderedAt={Date.now()}
          emptyText="No high-impact headlines in the last two days. New ones appear here and pop up on every page the moment they break."
        />
        <aside className="grid content-start gap-3 rounded-[var(--radius-control)] bg-hi/[0.03] p-4">
          <p className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
            Next high-impact releases
          </p>
          {next ? (
            <>
              <p className="flex items-center gap-2 text-sm font-medium">
                <CurrencyFlag currency={next.currency} />
                {next.currency} {next.title}
              </p>
              <Countdown
                to={next.startsAt}
                className="figures text-xl font-semibold text-[#f5b84d]"
              />
              <ul className="grid gap-1.5 border-t border-rule pt-3 text-xs text-ink-muted">
                {upcoming.slice(1, 4).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <CurrencyFlag currency={e.currency} />
                      <span className="truncate">{e.title}</span>
                    </span>
                    <time className="shrink-0" dateTime={e.startsAt}>
                      {new Date(e.startsAt).toLocaleString("en", {
                        weekday: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-ink-muted">None in the next 48 hours.</p>
          )}
          <Link href="/news" className="text-xs text-coach underline-offset-4 hover:underline">
            Economic calendar
          </Link>
        </aside>
      </div>
    </Panel>
  );
}
