import { type OrderflowResponse, REGIME_INFO } from "@atc/shared";
import { Split } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { coinName, usd } from "./format";

/** Dashboard summary: buying vs selling coins over 4 hours and the biggest flows each way. */
export function OrderflowWidget({ data }: { data: OrderflowResponse }) {
  const total = data.buying + data.selling;
  const bought = data.coins
    .filter((c) => c.netFlowUsd > 0)
    .sort((a, b) => b.netFlowUsd - a.netFlowUsd)
    .slice(0, 5);
  const sold = data.coins
    .filter((c) => c.netFlowUsd < 0)
    .sort((a, b) => a.netFlowUsd - b.netFlowUsd)
    .slice(0, 5);
  const list = (title: string, rows: typeof bought) => (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs text-ink-faint">{title}</p>
      <ul className="grid gap-1 text-sm">
        {rows.map((c) => (
          <li key={c.symbol} className="flex items-center justify-between gap-2">
            <Link
              href={`/orderflow?w=4h&c=${c.symbol}#coin`}
              className="truncate font-medium hover:underline"
              title={REGIME_INFO[c.regime].label}
            >
              {coinName(c.symbol)}
              {data.mine.includes(c.symbol) && <span className="ml-1 text-xs text-coach">●</span>}
            </Link>
            <span
              className={cn("figures shrink-0", c.netFlowUsd >= 0 ? "text-profit" : "text-loss")}
            >
              {usd(c.netFlowUsd, 1)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <section
      aria-labelledby="orderflow-widget-heading"
      className="grid min-w-0 content-start gap-4 rounded-[var(--radius-surface)] surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="orderflow-widget-heading" className="flex items-center gap-2 font-semibold">
          <Split className="h-4 w-4 text-coach" aria-hidden="true" />
          Order flow · 4h
        </h2>
        <Link
          href="/orderflow"
          className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Open
        </Link>
      </div>
      <div className="grid gap-1.5">
        <p className="figures flex justify-between text-sm">
          <span className="text-profit">{data.buying} net buying</span>
          <span className="text-loss">{data.selling} net selling</span>
        </p>
        {total > 0 && (
          <div className="flex h-2 overflow-hidden rounded-full" aria-hidden="true">
            <span className="bg-profit" style={{ width: `${(data.buying / total) * 100}%` }} />
            <span className="flex-1 bg-loss" />
          </div>
        )}
        <p className="text-xs text-ink-faint">
          Net taker flow {usd(data.netFlowUsd, 1)} across the top {data.universe} futures.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {list("Most bought", bought)}
        {list("Most sold", sold)}
      </div>
    </section>
  );
}
