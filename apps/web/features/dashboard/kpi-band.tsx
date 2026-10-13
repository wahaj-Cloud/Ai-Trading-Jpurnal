import type { AnalyticsDto } from "@atc/shared";
import { formatPercent, formatPnl, formatRatio, pnlTone } from "@/features/trades/format";
import { cn } from "@/lib/cn";

const TONE = { profit: "text-profit", loss: "text-loss", flat: "text-ink" } as const;

/**
 * One continuous instrument strip rather than five separate cards: the numbers are read together.
 */
export function KpiBand({ report }: { report: AnalyticsDto | null }) {
  const s = report?.summary;
  const metrics = [
    {
      label: "Net P&L",
      value: s ? formatPnl(s.netPnl) : "—",
      tone: s ? TONE[pnlTone(s.netPnl)] : "",
      hint: s ? `${s.trades} closed trades` : null,
    },
    {
      label: "Today",
      value: report ? formatPnl(report.today.pnl) : "—",
      tone: report ? TONE[pnlTone(report.today.pnl)] : "",
      hint: report ? `${report.today.trades} trades` : null,
    },
    {
      label: "This month",
      value: report ? formatPnl(report.thisMonth.pnl) : "—",
      tone: report ? TONE[pnlTone(report.thisMonth.pnl)] : "",
      hint: report ? `${report.thisMonth.trades} trades` : null,
    },
    {
      label: "Win rate",
      value: s ? formatPercent(s.winRate) : "—",
      tone: "",
      hint: s ? `${s.wins}W · ${s.losses}L` : null,
    },
    {
      label: "Profit factor",
      value: s ? formatRatio(s.profitFactor) : "—",
      tone: "",
      hint: s?.expectancy ? `${formatPnl(s.expectancy)} per trade` : null,
    },
  ];
  const empty = !s || s.trades === 0;

  return (
    <section aria-labelledby="kpi-heading" className="grid gap-3">
      <h2 id="kpi-heading" className="sr-only">
        Performance summary
      </h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="surface lift relative overflow-hidden rounded-[var(--radius-surface)] px-5 py-4 last:col-span-2 sm:last:col-span-1"
          >
            {/* A soft pool of light in the corner, tinted by the figure's own colour. */}
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full opacity-25 blur-2xl",
                empty
                  ? "bg-coach"
                  : m.tone === "text-profit"
                    ? "bg-profit"
                    : m.tone === "text-loss"
                      ? "bg-loss"
                      : "bg-coach",
              )}
            />
            <dt className="relative text-sm text-ink-muted">{m.label}</dt>
            <dd
              className={cn(
                "figures pop-text relative mt-1 leading-tight font-semibold whitespace-nowrap",
                // Long amounts (big balances, or currencies like Rs) step down so they fit the tile.
                m.value.length > 12 ? "text-xl" : m.value.length > 9 ? "text-2xl" : "text-[1.7rem]",
                empty ? "text-ink-faint" : m.tone || "text-ink",
              )}
            >
              {m.value}
            </dd>
            {m.hint && !empty && (
              <dd className="relative mt-0.5 text-xs text-ink-faint">{m.hint}</dd>
            )}
          </div>
        ))}
      </dl>
      {empty && (
        <p className="text-sm text-ink-muted">
          Figures fill in automatically after your first closed trade syncs.
        </p>
      )}
      {report && report.excluded.trades > 0 && (
        <p className="text-xs text-ink-faint">
          {report.excluded.trades} coin-margined trades (paid in {report.excluded.assets.join(", ")}
          ) are listed on Trades but not added to these USD totals.
        </p>
      )}
    </section>
  );
}
