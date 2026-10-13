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
    <section aria-labelledby="kpi-heading" className="rounded-[var(--radius-surface)] surface">
      <h2 id="kpi-heading" className="sr-only">
        Performance summary
      </h2>
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-rule">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="border-b border-rule px-5 py-4 last:col-span-2 sm:last:col-span-1 lg:border-b-0"
          >
            <dt className="text-sm text-ink-muted">{m.label}</dt>
            <dd
              className={cn(
                "figures mt-1 text-2xl font-semibold",
                empty ? "text-ink-faint" : m.tone || "text-ink",
              )}
            >
              {m.value}
            </dd>
            {m.hint && !empty && <dd className="mt-0.5 text-xs text-ink-faint">{m.hint}</dd>}
          </div>
        ))}
      </dl>
      {empty && (
        <p className="border-rule px-5 py-3 text-sm text-ink-muted lg:border-t">
          Figures fill in automatically after your first closed trade syncs.
        </p>
      )}
      {report && report.excluded.trades > 0 && (
        <p className="border-t border-rule px-5 py-2 text-xs text-ink-faint">
          {report.excluded.trades} coin-margined trades (paid in {report.excluded.assets.join(", ")}
          ) are listed on Trades but not added to these USD totals.
        </p>
      )}
    </section>
  );
}
