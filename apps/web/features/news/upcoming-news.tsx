import type { EconomicEventDto } from "@atc/shared";
import { cn } from "@/lib/cn";
import { nextEvent } from "./calendar-view";
import { Countdown } from "./countdown";
import { CurrencyFlag } from "./currency-flag";
import { ImpactBadge } from "./impact";

/** Dashboard card: the next few market-moving releases with a countdown to each. */
export function UpcomingNews({
  events,
  timeZone,
  limit = 6,
}: {
  events: EconomicEventDto[];
  timeZone: string;
  limit?: number;
}) {
  const now = Date.now();
  const list = events
    .filter((e) => e.tentative || new Date(e.startsAt).getTime() >= now - 60_000)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, limit);
  if (list.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No high or medium impact news in the next two days. A quieter market for news-driven moves.
      </p>
    );
  }
  const nextId = nextEvent(list)?.id;
  const fmt = new Intl.DateTimeFormat("en", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });
  return (
    <ul className="grid gap-2">
      {list.map((e) => (
        <li
          key={e.id}
          className={cn(
            "raised grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5",
            e.id === nextId && "ring-1 ring-coach/70",
          )}
        >
          <ImpactBadge impact={e.impact} showLabel={false} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium" title={e.title}>
              {e.title}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-ink-muted">
              <CurrencyFlag currency={e.currency} />
              {e.currency}
              {e.forecast && <span className="figures text-ink-faint">· f {e.forecast}</span>}
            </span>
          </span>
          <span className="text-right text-xs">
            <span className="figures block text-ink-muted">
              {e.tentative ? "Tentative" : fmt.format(new Date(e.startsAt))}
            </span>
            {!e.tentative && (
              <Countdown
                to={e.startsAt}
                className={cn("figures font-semibold", e.id === nextId ? "text-coach" : "text-ink")}
              />
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
