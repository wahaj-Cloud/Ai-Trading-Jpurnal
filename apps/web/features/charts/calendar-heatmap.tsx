import type { DayDto } from "@atc/shared";
import { formatPnl, formatPnlCompact } from "@/features/trades/format";

import { cn } from "@/lib/cn";

/** Whole units inside the small cells (the exact amount is in the label). */
const cellAmount = (v: string) =>
  Math.abs(Number(v)) >= 1000
    ? formatPnlCompact(v)
    : formatPnl(String(Math.round(Number(v)))).replace(".00", "");

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const monthName = new Intl.DateTimeFormat("en", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function daysIn(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Monday = 0 */
function firstWeekday(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
}

type Cell = { date: string; day: number; data: DayDto | undefined };

/** Rows of seven, padded with nulls before the 1st and after the last day. */
function weeksOf(lead: number, days: Cell[]): Array<Array<Cell | null>> {
  const cells: Array<Cell | null> = [...Array.from({ length: lead }, () => null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks: Array<Array<Cell | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function DayCell({ date, day, data, max, today }: Cell & { max: number; today: string }) {
  const pnl = Number(data?.pnl ?? 0);
  const strength = max === 0 || !data ? 0 : Math.sqrt(Math.abs(pnl) / max);
  const tint = pnl > 0 ? "var(--pnl-profit)" : "var(--pnl-loss)";
  const label = data
    ? `${date}: ${formatPnl(data.pnl)}, ${data.trades} trade${data.trades === 1 ? "" : "s"}`
    : `${date}: no trades`;
  return (
    <div
      title={label}
      aria-label={label}
      role="img"
      className={cn(
        "flex aspect-[6/5] min-h-9 flex-col justify-between rounded-[4px] border p-1",
        data ? "border-transparent" : "border-rule/60",
        date === today && "ring-1 ring-coach",
      )}
      style={
        data && pnl !== 0
          ? {
              background: `color-mix(in srgb, ${tint} ${Math.round(12 + strength * 58)}%, var(--color-panel))`,
            }
          : data
            ? { background: "var(--color-raised)" }
            : undefined
      }
    >
      <span className={cn("leading-none", data ? "text-ink" : "text-ink-faint")}>{day}</span>
      {data && (
        <span className="figures hidden truncate text-right leading-none text-ink sm:block">
          {cellAmount(data.pnl)}
        </span>
      )}
    </div>
  );
}

/**
 * P&L calendar: one cell per day, tinted by result (deeper = larger), with the amount printed in
 * the cell so the sign is never carried by colour alone. Intensity is relative to the largest day
 * shown, on a square-root scale so small days stay visible next to one outlier.
 */
export function CalendarHeatmap({
  months,
  days,
  today,
  weekTotals = false,
}: {
  /** YYYY-MM, in display order. */
  months: string[];
  days: DayDto[];
  /** YYYY-MM-DD in the trader's timezone. */
  today: string;
  /** Adds a column with each week's net result. */
  weekTotals?: boolean;
}) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const max = Math.max(...days.map((d) => Math.abs(Number(d.pnl))), 0);

  return (
    <div
      className={cn(
        "grid gap-6",
        months.length === 1 ? "max-w-xl" : "sm:grid-cols-2 xl:grid-cols-3",
      )}
    >
      {months.map((month) => {
        const count = daysIn(month);
        const lead = firstWeekday(month);
        const monthDays = Array.from({ length: count }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, "0")}`;
          return { date, day: i + 1, data: byDate.get(date) };
        });
        const total = monthDays.reduce((s, d) => s + Number(d.data?.pnl ?? 0), 0);
        return (
          <section key={month} aria-label={monthName.format(new Date(`${month}-01T00:00:00Z`))}>
            <header className="mb-2 flex items-baseline justify-between text-sm">
              <h3 className="font-medium">{monthName.format(new Date(`${month}-01T00:00:00Z`))}</h3>
              <span
                className={cn(
                  "figures",
                  total > 0 ? "text-profit" : total < 0 ? "text-loss" : "text-ink-muted",
                )}
              >
                {formatPnl(String(total))}
              </span>
            </header>
            <div
              className={cn(
                "grid gap-[2px] text-[11px]",
                weekTotals ? "grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.15fr)]" : "grid-cols-7",
              )}
            >
              {WEEKDAYS.map((w, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed weekday header
                  key={i}
                  className="pb-1 text-center text-ink-faint"
                  aria-hidden="true"
                >
                  {w}
                </span>
              ))}
              {weekTotals && (
                <span className="pb-1 text-center text-ink-faint" aria-hidden="true">
                  Week
                </span>
              )}
              {weeksOf(lead, monthDays).map((week, wi) => {
                const weekPnl = week.reduce((sum, d) => sum + Number(d?.data?.pnl ?? 0), 0);
                const weekTrades = week.reduce((sum, d) => sum + (d?.data?.trades ?? 0), 0);
                return [
                  ...week.map((cell, ci) =>
                    cell ? (
                      <DayCell key={cell.date} {...cell} max={max} today={today} />
                    ) : (
                      // biome-ignore lint/suspicious/noArrayIndexKey: empty padding cells
                      <span key={`pad-${wi}-${ci}`} aria-hidden="true" />
                    ),
                  ),
                  weekTotals ? (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: weeks are fixed rows of the month
                      key={`week-${wi}`}
                      role="img"
                      aria-label={`Week ${wi + 1}: ${formatPnl(String(weekPnl))}, ${weekTrades} trades`}
                      className="flex min-h-9 flex-col items-end justify-center rounded-[4px] border border-rule/60 bg-raised/50 px-1.5"
                    >
                      <span
                        className={cn(
                          "figures truncate font-semibold leading-tight",
                          weekPnl > 0
                            ? "text-profit"
                            : weekPnl < 0
                              ? "text-loss"
                              : "text-ink-faint",
                        )}
                      >
                        {weekTrades ? cellAmount(String(weekPnl)) : "—"}
                      </span>
                      {weekTrades > 0 && (
                        <span className="hidden leading-tight text-ink-faint sm:block">
                          {weekTrades} tr
                        </span>
                      )}
                    </div>
                  ) : null,
                ];
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
