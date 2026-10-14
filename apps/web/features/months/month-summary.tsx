import type { DayDto } from "@atc/shared";
import { FitText } from "@/components/ui/fit-text";
import { formatPercent, formatPnl } from "@/features/trades/format";
import { cn } from "@/lib/cn";
import { monthStats } from "./month-stats";

const shortDay = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" });
const dayName = (date: string) => shortDay.format(new Date(`${date}T00:00:00Z`));

/** A month's headline figures as a row of raised chips. `detailed` adds best and worst day. */
export function MonthSummary({
  days,
  month,
  detailed = false,
}: {
  days: readonly DayDto[];
  month: string;
  detailed?: boolean;
}) {
  const s = monthStats(days, month);
  if (s.trades === 0) {
    return <p className="text-sm text-ink-muted">No closed trades in this month.</p>;
  }
  const tone = (n: number) => (n > 0 ? "text-profit" : n < 0 ? "text-loss" : "text-ink");
  const chips: Array<{ label: string; value: string; tone?: string; hint?: string }> = [
    { label: "Net P&L", value: formatPnl(s.net.toFixed(2)), tone: tone(s.net) },
    { label: "Trades", value: String(s.trades), hint: `${s.wins} won` },
    { label: "Win rate", value: formatPercent(s.winRate, 0) },
    {
      label: "Green days",
      value: `${s.greenDays} of ${s.tradingDays}`,
      hint: s.redDays ? `${s.redDays} red` : undefined,
    },
  ];
  if (detailed) {
    chips.push(
      {
        label: "Best day",
        value: s.best ? formatPnl(s.best.pnl) : "—",
        tone: "text-profit",
        hint: s.best ? dayName(s.best.date) : undefined,
      },
      {
        label: "Worst day",
        value: s.worst ? formatPnl(s.worst.pnl) : "—",
        tone: "text-loss",
        hint: s.worst ? dayName(s.worst.date) : undefined,
      },
      {
        label: "Average day",
        value: s.avgDay === null ? "—" : formatPnl(s.avgDay.toFixed(2)),
        tone: tone(s.avgDay ?? 0),
      },
    );
  }
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-2 sm:gap-3",
        detailed ? "sm:grid-cols-4 lg:grid-cols-7" : "sm:grid-cols-4",
      )}
    >
      {chips.map((c) => (
        <div key={c.label} className="raised min-w-0 rounded-[var(--radius-control)] px-3 py-2.5">
          <dt className="text-[11px] text-ink-muted">{c.label}</dt>
          <dd className={cn("figures pop-text mt-0.5 text-base font-semibold", c.tone)}>
            <FitText>{c.value}</FitText>
          </dd>
          {c.hint && <dd className="text-[11px] text-ink-faint">{c.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
