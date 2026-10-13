import type { BucketDto } from "@atc/shared";
import { formatPercent, formatPnl, formatPnlCompact } from "@/features/trades/format";
import { cn } from "@/lib/cn";

/**
 * Net P&L per category (hour, weekday, session) as columns around a zero line: winners rise,
 * losers fall, so polarity reads from position even without colour. Hover or focus a column for
 * its exact figures. Server-rendered HTML: no chart library needed for categorical data.
 */
export function PnlColumns({
  title,
  buckets,
  label = (key) => key,
  height = 160,
}: {
  title: string;
  buckets: BucketDto[];
  label?: (key: string) => string;
  height?: number;
}) {
  const max = Math.max(...buckets.map((b) => Math.abs(Number(b.pnl))), 0);
  const hasNegative = buckets.some((b) => Number(b.pnl) < 0);
  const hasPositive = buckets.some((b) => Number(b.pnl) > 0);
  // Give the zero line room on the side(s) that have data.
  const upShare = !hasNegative ? 1 : !hasPositive ? 0 : 0.5;

  return (
    <figure className="grid gap-3">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      <div
        className="relative grid items-stretch gap-[2px]"
        style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`, height }}
      >
        <div
          className="pointer-events-none absolute inset-x-0 h-px bg-rule"
          style={{ top: `${upShare * 100}%` }}
          aria-hidden="true"
        />
        {buckets.map((b) => {
          const v = Number(b.pnl);
          const share = max === 0 ? 0 : Math.abs(v) / max;
          const up = v >= 0;
          const text = `${label(b.key)}: ${formatPnl(b.pnl)} over ${b.trades} trade${b.trades === 1 ? "" : "s"}, win rate ${formatPercent(b.winRate, 0)}`;
          return (
            <div
              key={b.key}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: focus reveals the exact figures for keyboard users
              tabIndex={0}
              role="img"
              aria-label={text}
              className="group relative outline-none"
            >
              <div
                className={cn(
                  "absolute inset-x-0 mx-auto w-full max-w-7 transition-opacity group-hover:opacity-80",
                  up ? "pop-bar rounded-t-[5px] bg-profit" : "pop-bar rounded-b-[5px] bg-loss",
                  b.trades === 0 && "hidden",
                )}
                style={
                  up
                    ? {
                        bottom: `${(1 - upShare) * 100}%`,
                        height: `max(${share * upShare * 100}%, 2px)`,
                      }
                    : {
                        top: `${upShare * 100}%`,
                        height: `max(${share * (1 - upShare) * 100}%, 2px)`,
                      }
                }
              />
              <div
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-max max-w-48 -translate-x-1/2 pop rounded-[var(--radius-control)] px-3 py-2 text-xs group-hover:block group-focus-visible:block"
              >
                <p className="font-medium">{label(b.key)}</p>
                <p
                  className={cn(
                    "figures pop-text text-sm font-semibold",
                    Number(b.pnl) >= 0 ? "text-profit" : "text-loss",
                  )}
                >
                  {formatPnl(b.pnl)}
                </p>
                <p className="text-ink-muted">
                  {b.trades} trades · {formatPercent(b.winRate, 0)} won
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div
        className="grid gap-[2px] text-center text-[11px] text-ink-faint"
        style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {buckets.map((b, i) => (
          <span key={b.key} className={cn(buckets.length > 12 && i % 3 !== 0 && "invisible")}>
            {label(b.key)}
          </span>
        ))}
      </div>
      {max > 0 && (
        <p className="figures text-[11px] text-ink-faint" aria-hidden="true">
          Tallest column: {formatPnlCompact(max)}
        </p>
      )}
    </figure>
  );
}
