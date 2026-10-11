import type { BucketDto } from "@atc/shared";
import { formatPercent, formatPnl, pnlTone } from "@/features/trades/format";
import { cn } from "@/lib/cn";

const TONE = { profit: "text-profit", loss: "text-loss", flat: "text-ink-muted" } as const;

/**
 * A ranked table with an inline bar per row (share of the largest result), for categories that
 * can run long: coins, setups, mistakes. The bar grows from a centre line in the result's direction.
 */
export function BucketTable({
  buckets,
  keyLabel,
  label = (k) => k,
  limit = 12,
  empty,
}: {
  buckets: BucketDto[];
  keyLabel: string;
  label?: (key: string) => string;
  limit?: number;
  empty?: string;
}) {
  if (buckets.length === 0) {
    return <p className="text-sm text-ink-muted">{empty ?? "Nothing to show yet."}</p>;
  }
  const rows = buckets.slice(0, limit);
  const max = Math.max(...rows.map((b) => Math.abs(Number(b.pnl))), 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-muted">
          <tr className="border-b border-rule">
            <th scope="col" className="py-2 pr-3 font-medium">
              {keyLabel}
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Trades
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Win rate
            </th>
            <th scope="col" className="w-2/5 py-2 text-right font-medium">
              Net P&amp;L
            </th>
          </tr>
        </thead>
        <tbody className="figures">
          {rows.map((b) => {
            const v = Number(b.pnl);
            const share = max ? (Math.abs(v) / max) * 50 : 0;
            return (
              <tr key={b.key} className="border-b border-rule/60 last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-medium">
                  {label(b.key)}
                </th>
                <td className="py-2 pr-3 text-right text-ink-muted">{b.trades}</td>
                <td className="py-2 pr-3 text-right text-ink-muted">
                  {formatPercent(b.winRate, 0)}
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-3">
                    <div className="relative hidden h-2 flex-1 sm:block" aria-hidden="true">
                      <span className="absolute inset-y-0 left-1/2 w-px bg-rule" />
                      <span
                        className={cn(
                          "absolute inset-y-0",
                          v >= 0
                            ? "left-1/2 rounded-r-[4px] bg-profit"
                            : "right-1/2 rounded-l-[4px] bg-loss",
                        )}
                        style={{ width: `${share}%` }}
                      />
                    </div>
                    <span className={cn("w-24 text-right", TONE[pnlTone(b.pnl)])}>
                      {formatPnl(b.pnl)}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {buckets.length > limit && (
        <p className="mt-2 text-xs text-ink-faint">
          Showing {limit} of {buckets.length}.
        </p>
      )}
    </div>
  );
}
