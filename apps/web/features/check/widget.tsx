import type { TradeCheckDto } from "@atc/shared";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Panel } from "@/features/analytics/metric";
import { BiasChip } from "@/features/flow/views";
import { cn } from "@/lib/cn";

/** Dashboard summary of Trade Check for one market: the count, the trend and the top risk flags. */
export function TradeCheckWidget({ check }: { check: TradeCheckDto }) {
  const { long, short, neutral } = check.tally;
  const total = long + short + neutral || 1;
  const flags = check.flags.slice(0, 2);
  return (
    <Panel
      title={`Trade Check · ${check.name}`}
      action={
        <Link
          href={`/check?s=${check.symbol}`}
          className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Open
        </Link>
      }
    >
      <div className="grid gap-3">
        <p className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-profit">
            <span className="figures text-2xl font-semibold">{long}</span> longs
          </span>
          <span className="text-ink-muted">
            <span className="figures text-lg">{neutral}</span> neutral
          </span>
          <span className="text-loss">
            <span className="figures text-2xl font-semibold">{short}</span> shorts
          </span>
        </p>
        <div className="flex h-2 overflow-hidden rounded-full bg-hi/[0.06]" aria-hidden="true">
          <span className="bg-profit/80" style={{ width: `${(long / total) * 100}%` }} />
          <span className="bg-hi/25" style={{ width: `${(neutral / total) * 100}%` }} />
          <span className="bg-loss/80" style={{ width: `${(short / total) * 100}%` }} />
        </div>
        {check.biases.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {check.biases.map((b) => (
              <BiasChip key={b.timeframe} bias={b} showTf />
            ))}
          </div>
        )}
        {flags.length > 0 ? (
          <ul className="grid gap-1.5">
            {flags.map((f) => (
              <li
                key={f.key}
                className={cn(
                  "flex gap-2 rounded-[var(--radius-control)] border p-2 text-xs",
                  f.level === "high" ? "border-loss/50" : "border-[#f5b84d]/40",
                )}
              >
                <AlertTriangle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#f5b84d]"
                  aria-hidden="true"
                />
                {f.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-muted">No risk flags right now.</p>
        )}
        <p className="text-xs text-ink-faint">A count of readings, not a call.</p>
      </div>
    </Panel>
  );
}
