import type { ReactNode } from "react";
import { pnlTone } from "@/features/trades/format";
import { cn } from "@/lib/cn";

const TONE = { profit: "text-profit", loss: "text-loss", flat: "text-ink" } as const;

/** One figure with its label; money figures take profit/loss colour from their sign. */
export function Metric({
  label,
  value,
  signed,
  hint,
  size = "md",
}: {
  label: string;
  value: ReactNode;
  /** Raw decimal string whose sign colours the value. */
  signed?: string | null;
  hint?: ReactNode;
  size?: "md" | "lg";
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd
        className={cn(
          "figures mt-1 truncate font-semibold",
          size === "lg" ? "text-2xl" : "text-lg",
          signed !== undefined ? TONE[pnlTone(signed ?? null)] : "text-ink",
        )}
      >
        {value}
      </dd>
      {hint && <dd className="mt-0.5 truncate text-xs text-ink-faint">{hint}</dd>}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section
      aria-labelledby={id}
      className={cn("min-w-0 rounded-[var(--radius-surface)] surface p-5 sm:p-6", className)}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id={id} className="font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
