import type { StrategyInsightDto } from "@atc/shared";
import { formatPercent, formatPnl, pnlTone } from "@/features/trades/format";

const TONE = { profit: "text-profit", loss: "text-loss", flat: "text-ink-muted" } as const;

/** Win rate and result with vs against each entry/exit condition, across analysed trades. */
export function StrategyInsights({ insights }: { insights: StrategyInsightDto[] }) {
  if (insights.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Once your trades are analysed against the chart, this shows which conditions (trend, value
        entries, premium/discount, structure) actually make you money.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-muted">
          <tr className="border-b border-rule">
            <th scope="col" className="py-2 pr-3 font-medium">
              Condition
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              When true
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              When false
            </th>
          </tr>
        </thead>
        <tbody className="figures">
          {insights.map((i) => (
            <tr key={i.code} className="border-b border-rule/60 last:border-0">
              <th scope="row" className="py-2 pr-3 text-left font-normal">
                {i.label}
              </th>
              {[i.withCheck, i.againstCheck].map((s, k) => (
                <td key={k === 0 ? "with" : "against"} className="py-2 pr-3 text-right">
                  <span className={TONE[pnlTone(s.netPnl)]}>{formatPnl(s.netPnl)}</span>
                  <span className="block text-xs text-ink-muted">
                    {s.trades} trades · {formatPercent(s.winRate, 0)} won
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
