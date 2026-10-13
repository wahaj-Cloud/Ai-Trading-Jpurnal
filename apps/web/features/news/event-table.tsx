import type { EconomicEventDto } from "@atc/shared";
import { cn } from "@/lib/cn";
import type { EventDay } from "./calendar-view";
import { Countdown } from "./countdown";
import { CurrencyFlag } from "./currency-flag";
import { ImpactBadge } from "./impact";

const timeLabel = (e: EconomicEventDto, fmt: Intl.DateTimeFormat) =>
  e.tentative
    ? /holiday/i.test(e.title)
      ? "All day"
      : "Tentative"
    : fmt.format(new Date(e.startsAt));

function Value({ v, strong }: { v: string | null; strong?: boolean }) {
  return v ? (
    <span className={cn("figures", strong ? "font-semibold text-ink" : "text-ink-muted")}>{v}</span>
  ) : (
    <span className="text-ink-faint">—</span>
  );
}

function Currency({ code }: { code: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-medium">
      <CurrencyFlag currency={code} />
      {code}
    </span>
  );
}

/**
 * Forex Factory style calendar: one block per day, each release with its time, currency, impact,
 * and the actual / forecast / previous figures. Past releases are dimmed; the next one is marked
 * with a live countdown.
 */
export function EventTable({
  days,
  timeZone,
  nextId,
  now,
}: {
  days: EventDay[];
  timeZone: string;
  nextId: string | null;
  now: number;
}) {
  const fmt = new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });
  const past = (e: EconomicEventDto) =>
    e.tentative ? false : new Date(e.startsAt).getTime() < now - 60_000;

  return (
    <div className="grid gap-5">
      {days.map((day) => (
        <section key={day.key} aria-label={day.label}>
          <h3
            className={cn(
              "mb-2 flex items-center gap-2 text-sm font-semibold",
              day.label.startsWith("Today") ? "text-coach" : "text-ink",
            )}
          >
            {day.label}
            <span className="text-xs font-normal text-ink-faint">
              {day.events.length} {day.events.length === 1 ? "event" : "events"}
            </span>
          </h3>

          {/* Desktop and tablet: a table */}
          <div className="hidden overflow-hidden rounded-[var(--radius-control)] border border-rule md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-well text-left text-xs text-ink-muted">
                  <th scope="col" className="w-20 px-3 py-2 font-medium">
                    Time
                  </th>
                  <th scope="col" className="w-24 px-3 py-2 font-medium">
                    Currency
                  </th>
                  <th scope="col" className="w-28 px-3 py-2 font-medium">
                    Impact
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Event
                  </th>
                  <th scope="col" className="w-24 px-3 py-2 text-right font-medium">
                    Actual
                  </th>
                  <th scope="col" className="w-24 px-3 py-2 text-right font-medium">
                    Forecast
                  </th>
                  <th scope="col" className="w-24 px-3 py-2 text-right font-medium">
                    Previous
                  </th>
                </tr>
              </thead>
              <tbody>
                {day.events.map((e) => {
                  const isNext = e.id === nextId;
                  return (
                    <tr
                      key={e.id}
                      className={cn(
                        "border-t border-rule/60 transition-colors hover:bg-hi/[0.04]",
                        past(e) && "opacity-55",
                        isNext && "bg-coach/[0.08] shadow-[inset_3px_0_0_var(--color-coach)]",
                      )}
                    >
                      <td className="figures px-3 py-2.5 whitespace-nowrap text-ink-muted">
                        {timeLabel(e, fmt)}
                      </td>
                      <td className="px-3 py-2.5">
                        <Currency code={e.currency} />
                      </td>
                      <td className="px-3 py-2.5">
                        <ImpactBadge impact={e.impact} />
                      </td>
                      <th scope="row" className="px-3 py-2.5 text-left font-medium">
                        <span className="flex flex-wrap items-center gap-2">
                          {e.title}
                          {isNext && (
                            <span className="pop inline-flex items-center gap-1 rounded-full bg-coach px-2 py-px text-[11px] font-semibold text-coach-ink">
                              Next · <Countdown to={e.startsAt} />
                            </span>
                          )}
                        </span>
                      </th>
                      <td className="px-3 py-2.5 text-right">
                        <Value v={e.actual} strong />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Value v={e.forecast} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Value v={e.previous} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phones: stacked cards */}
          <ul className="grid gap-2 md:hidden">
            {day.events.map((e) => {
              const isNext = e.id === nextId;
              return (
                <li
                  key={e.id}
                  className={cn(
                    "raised rounded-[var(--radius-control)] p-3",
                    past(e) && "opacity-55",
                    isNext && "ring-1 ring-coach",
                  )}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="figures text-ink-muted">{timeLabel(e, fmt)}</span>
                    <span className="flex items-center gap-3">
                      <Currency code={e.currency} />
                      <ImpactBadge impact={e.impact} showLabel={false} />
                    </span>
                  </div>
                  <p className="mt-1.5 font-medium">{e.title}</p>
                  {isNext && (
                    <p className="mt-1 text-xs font-semibold text-coach">
                      Next · <Countdown to={e.startsAt} />
                    </p>
                  )}
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    {(
                      [
                        ["Actual", e.actual, true],
                        ["Forecast", e.forecast, false],
                        ["Previous", e.previous, false],
                      ] as const
                    ).map(([label, v, strong]) => (
                      <div key={label}>
                        <dt className="text-ink-faint">{label}</dt>
                        <dd>
                          <Value v={v} strong={strong} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
