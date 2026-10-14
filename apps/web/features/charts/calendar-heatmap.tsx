import type { DayDto } from "@atc/shared";
import Link from "next/link";
import { FitText } from "@/components/ui/fit-text";
import { formatPnl, formatPnlCompact, formatSignedTiny } from "@/features/trades/format";

import { cn } from "@/lib/cn";

/** Whole units inside the small cells (the exact amount is in the label). */
const cellAmount = (v: string) =>
  Math.abs(Number(v)) >= 1000
    ? formatPnlCompact(v)
    : formatPnl(String(Math.round(Number(v)))).replace(".00", "");

/**
 * The amount inside a cell: symbol-less and tiny on phones (cells are ~45px wide), with the
 * currency symbol from the small-tablet width up. Both are clipped to the cell, never spilling.
 */
function CellAmount({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn("figures block w-full min-w-0", className)}>
      <span className="block overflow-hidden text-ellipsis whitespace-nowrap tracking-tighter sm:hidden">
        {formatSignedTiny(value)}
      </span>
      <span className="hidden sm:block">
        <FitText min={0.65}>{cellAmount(value)}</FitText>
      </span>
    </span>
  );
}

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

function DayCell({
  date,
  day,
  data,
  max,
  today,
  large,
  href,
}: Cell & { max: number; today: string; large: boolean; href?: string }) {
  const pnl = Number(data?.pnl ?? 0);
  const strength = max === 0 || !data ? 0 : Math.sqrt(Math.abs(pnl) / max);
  const tint = pnl > 0 ? "var(--pnl-profit)" : "var(--pnl-loss)";
  const label = data
    ? `${date}: ${formatPnl(data.pnl)}, ${data.trades} trade${data.trades === 1 ? "" : "s"}`
    : `${date}: no trades`;
  const props = {
    title: href ? `${label}. Open this day's trades` : label,
    "aria-label": href ? `${label}. Open this day's trades` : label,
    className: cn(
      href && "cursor-pointer transition-[filter,transform] hover:brightness-125 active:scale-95",
      "flex min-w-0 flex-col overflow-hidden rounded-lg border",
      large
        ? "h-14 px-0.5 py-1 sm:h-16 sm:p-1.5 lg:h-[4.5rem]"
        : "aspect-[6/5] min-h-9 justify-between p-1",
      data
        ? "lift border-hi/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),inset_0_-1px_0_rgba(0,0,0,0.25),0_8px_16px_-8px_rgba(0,0,0,0.75)]"
        : "border-rule/60",
      date === today && "ring-1 ring-coach",
    ),
    style:
      data && pnl !== 0
        ? {
            background: `color-mix(in srgb, ${tint} ${Math.round(12 + strength * 58)}%, var(--color-panel))`,
          }
        : data
          ? { background: "var(--color-raised)" }
          : undefined,
  };
  const body = (
    <>
      <span
        className={cn(
          "leading-none",
          data ? "text-ink/80" : "text-ink-faint/70",
          large && "text-[10px] sm:text-[11px]",
        )}
      >
        {day}
      </span>
      {data &&
        (large ? (
          <span className="flex w-full min-w-0 flex-1 flex-col items-center justify-center text-center">
            <CellAmount
              value={data.pnl}
              className="pop-text text-center text-[9px] leading-tight font-semibold text-ink sm:text-xs lg:text-sm"
            />
            <span className="hidden text-[10px] leading-tight text-ink/70 sm:block">
              {data.trades} {data.trades === 1 ? "trade" : "trades"}
            </span>
          </span>
        ) : (
          <CellAmount
            value={data.pnl}
            className="hidden text-right leading-none text-ink sm:block"
          />
        ))}
    </>
  );
  return href ? (
    <Link href={href} {...props}>
      {body}
    </Link>
  ) : (
    <div role="img" {...props}>
      {body}
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
  large = false,
  monthHref,
  linkDays = true,
}: {
  /** YYYY-MM, in display order. */
  months: string[];
  days: DayDto[];
  /** YYYY-MM-DD in the trader's timezone. */
  today: string;
  /** Adds a column with each week's net result. */
  weekTotals?: boolean;
  /** Taller cells that fill the container, with the amount centred (single-month views). */
  large?: boolean;
  /** Turns each month title into a link, e.g. to its full month page. */
  monthHref?: (month: string) => string;
  /** Days with trades link to that day's trades (on by default). */
  linkDays?: boolean;
}) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const max = Math.max(...days.map((d) => Math.abs(Number(d.pnl))), 0);

  return (
    <div
      className={cn(
        "grid gap-6",
        months.length === 1 ? (large ? "" : "max-w-xl") : "sm:grid-cols-2 xl:grid-cols-3",
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
            <header
              className={cn(
                "flex items-center justify-between gap-3",
                large ? "mb-3 text-base" : "mb-2 text-sm",
              )}
            >
              <h3 className="font-medium">
                {monthHref ? (
                  <Link
                    href={monthHref(month)}
                    className="underline-offset-4 hover:text-coach hover:underline"
                  >
                    {monthName.format(new Date(`${month}-01T00:00:00Z`))}
                  </Link>
                ) : (
                  monthName.format(new Date(`${month}-01T00:00:00Z`))
                )}
              </h3>
              <span
                className={cn(
                  "figures font-semibold",
                  large && "pop-text rounded-full border border-hi/10 bg-well px-3 py-0.5",
                  total > 0 ? "text-profit" : total < 0 ? "text-loss" : "text-ink-muted",
                )}
              >
                {formatPnl(String(total))}
              </span>
            </header>
            <div
              className={cn(
                "grid text-[11px]",
                large ? "gap-1 sm:gap-1.5" : "gap-[2px]",
                weekTotals
                  ? large
                    ? "grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.1fr)] [&>*:nth-child(8n)]:ml-1 sm:[&>*:nth-child(8n)]:ml-2"
                    : "grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.15fr)]"
                  : "grid-cols-7",
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
                      <DayCell
                        key={cell.date}
                        {...cell}
                        max={max}
                        today={today}
                        large={large}
                        href={linkDays && cell.data ? `/trades?day=${cell.date}` : undefined}
                      />
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
                      className={cn(
                        "raised flex min-w-0 flex-col justify-center overflow-hidden rounded-lg px-0.5 sm:px-1",
                        large ? "h-14 items-center sm:h-16 lg:h-[4.5rem]" : "min-h-9 items-end",
                      )}
                    >
                      {weekTrades ? (
                        <CellAmount
                          value={String(weekPnl)}
                          className={cn(
                            "font-semibold leading-tight",
                            large && "pop-text text-center text-[9px] sm:text-xs lg:text-sm",
                            weekPnl > 0
                              ? "text-profit"
                              : weekPnl < 0
                                ? "text-loss"
                                : "text-ink-faint",
                          )}
                        />
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                      {weekTrades > 0 && (
                        <span className="hidden text-[10px] leading-tight text-ink-faint sm:block">
                          {weekTrades} {large ? (weekTrades === 1 ? "trade" : "trades") : "tr"}
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
