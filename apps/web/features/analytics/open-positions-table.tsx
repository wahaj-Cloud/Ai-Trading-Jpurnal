import { EXCHANGE_CATALOG, type OpenPositionsDto } from "@atc/shared";
import { formatNumber, formatPercent, formatPnl, pnlTone } from "@/features/trades/format";
import { cn } from "@/lib/cn";

const TONE = { profit: "text-profit", loss: "text-loss", flat: "text-ink-muted" } as const;

function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

/** Live positions with unrealised P&L. Liquidation within 10% of the mark price is flagged. */
export function OpenPositionsTable({
  data,
  compact = false,
}: {
  data: OpenPositionsDto;
  compact?: boolean;
}) {
  const now = Date.now();
  if (data.items.length === 0) {
    return <p className="text-sm text-ink-muted">No open positions right now.</p>;
  }
  return (
    <div className="grid gap-3">
      <ul className="grid gap-2">
        {data.items.map((p) => {
          const near = p.liquidationDistance !== null && p.liquidationDistance < 0.1;
          return (
            <li
              key={p.id}
              className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-[var(--radius-control)] border border-rule bg-canvas/40 px-3 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-medium">{p.symbol}</span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-xs font-medium",
                    p.direction === "LONG" ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss",
                  )}
                >
                  {p.direction === "LONG" ? "Long" : "Short"}
                </span>
                {p.leverage && (
                  <span className="figures text-xs text-ink-muted">
                    {formatNumber(p.leverage)}x
                  </span>
                )}
              </div>
              <p className={cn("figures text-right font-medium", TONE[pnlTone(p.unrealizedPnl)])}>
                {formatPnl(p.unrealizedPnl, p.settleAsset)}{" "}
                <span className="text-xs text-ink-faint">{p.settleAsset}</span>
              </p>
              <p className="figures truncate text-xs text-ink-muted">
                {formatNumber(p.quantity)} {p.sizeAsset} @ {formatNumber(p.entryPrice)}
                {!compact && ` · mark ${formatNumber(p.markPrice)}`}
                {!compact && ` · ${p.accountLabel || EXCHANGE_CATALOG[p.exchange].name}`}
              </p>
              <p
                className={cn(
                  "figures text-right text-xs",
                  near ? "font-medium text-loss" : "text-ink-faint",
                )}
              >
                {p.liquidationDistance === null
                  ? ""
                  : `${near ? "Liquidation close: " : "Liq. "}${formatPercent(p.liquidationDistance)} away`}
              </p>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-ink-muted">
        <span>
          Unrealised total{" "}
          <span className={cn("figures text-sm font-medium", TONE[pnlTone(data.unrealizedPnl)])}>
            {formatPnl(data.unrealizedPnl)}
          </span>
        </span>
        {data.asOf && <span>Updated {ago(data.asOf, now)} · refreshes every few minutes</span>}
      </div>
    </div>
  );
}
