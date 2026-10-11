import { BEHAVIOURS, type BehaviourSummaryDto } from "@atc/shared";
import { formatPnl, pnlTone } from "@/features/trades/format";
import { cn } from "@/lib/cn";

/** Behaviours ranked by what they cost, with the trader's own numbers. */
export function Habits({ summary, limit = 5 }: { summary: BehaviourSummaryDto; limit?: number }) {
  const rows = summary.costByBehaviour.slice(0, limit);
  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No problem habits detected in the last 30 days. Journal your trades so the coach can spot
        more (emotions, mistakes, planned stops).
      </p>
    );
  }
  return (
    <ul className="grid gap-2">
      {rows.map((r) => {
        const flag = summary.flags.find((f) => f.code === r.code);
        return (
          <li key={r.code} className="grid grid-cols-[1fr_auto] gap-x-3 text-sm">
            <span className="font-medium">{BEHAVIOURS[r.code].label}</span>
            <span
              className={cn(
                "figures text-right",
                pnlTone(r.netPnl) === "loss"
                  ? "text-loss"
                  : pnlTone(r.netPnl) === "profit"
                    ? "text-profit"
                    : "text-ink-muted",
              )}
            >
              {formatPnl(r.netPnl)}
            </span>
            <span className="col-span-2 text-xs text-ink-muted">
              {r.trades} trade{r.trades === 1 ? "" : "s"} ·{" "}
              {flag?.evidence.split(". ")[0] ?? BEHAVIOURS[r.code].about}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
