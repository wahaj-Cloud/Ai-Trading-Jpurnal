import type { Grade } from "@atc/shared";
import { cn } from "@/lib/cn";

/** The letter carries the meaning; colour only reinforces it. */
export function GradeBadge({
  grade,
  score,
  size = "md",
}: {
  grade: Grade;
  score?: number;
  size?: "sm" | "md" | "lg";
}) {
  const tone = grade.startsWith("A")
    ? "border-profit/50 bg-profit/15 text-profit"
    : grade === "B"
      ? "border-profit/30 bg-profit/10 text-ink"
      : grade === "C"
        ? "border-rule bg-raised text-ink"
        : "border-loss/50 bg-loss/15 text-loss";
  return (
    <span
      className={cn(
        "figures inline-flex items-center justify-center rounded-[var(--radius-control)] border font-semibold",
        size === "lg"
          ? "h-14 min-w-14 px-3 text-3xl"
          : size === "md"
            ? "h-9 min-w-9 px-2 text-lg"
            : "h-6 min-w-6 px-1.5 text-xs",
        tone,
      )}
      title={score !== undefined ? `Grade ${grade}, ${score}/100` : `Grade ${grade}`}
    >
      {grade}
      {score !== undefined && <span className="sr-only">, {score} out of 100</span>}
    </span>
  );
}
