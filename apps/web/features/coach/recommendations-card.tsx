import { AlertTriangle, ArrowRight, Lightbulb, TrendingUp } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { MIN_TRADES_FOR_ADVICE, type Recommendation } from "./recommendations";

const ICON = { warn: AlertTriangle, good: TrendingUp, tip: Lightbulb } as const;
const TONE = {
  warn: "text-loss bg-loss/12",
  good: "text-profit bg-profit/12",
  tip: "text-coach bg-coach/12",
} as const;

/** Numbered, specific fixes from the trader's own data. */
export function RecommendationsList({
  items,
  columns = false,
}: {
  items: Recommendation[];
  /** Two columns on wide screens (dashboard); one column in side panels. */
  columns?: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Suggestions appear after {MIN_TRADES_FOR_ADVICE} closed trades, once there is a pattern to
        read.
      </p>
    );
  }
  return (
    <ol className={cn("grid gap-3", columns && "lg:grid-cols-2")}>
      {items.map((r, i) => {
        const Icon = ICON[r.tone];
        return (
          <li key={r.id} className="raised flex gap-3 rounded-[var(--radius-control)] p-3.5">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                TONE[r.tone],
              )}
              aria-hidden="true"
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="font-medium leading-snug">
                <span className="sr-only">{i + 1}. </span>
                {r.title}
              </p>
              <p className="mt-1 text-sm text-ink-muted">{r.detail}</p>
              {r.action && (
                <Link
                  href={r.action.href}
                  className="mt-2 inline-flex items-center gap-1 text-sm text-coach underline-offset-4 hover:underline"
                >
                  {r.action.label}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
