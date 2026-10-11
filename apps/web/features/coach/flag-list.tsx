import { BEHAVIOURS, type BehaviourFlagDto } from "@atc/shared";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";

const SEVERITY = {
  HIGH: "border-loss/50 text-loss",
  MEDIUM: "border-coach/50 text-coach",
  LOW: "border-rule text-ink-muted",
} as const;

export function FlagList({ flags, empty }: { flags: BehaviourFlagDto[]; empty?: string }) {
  if (flags.length === 0)
    return <p className="text-sm text-ink-muted">{empty ?? "No problem behaviours detected."}</p>;
  return (
    <ul className="grid gap-2">
      {flags.map((f) => (
        <li
          key={f.code}
          className="flex gap-3 rounded-[var(--radius-control)] border border-rule bg-canvas/40 px-3 py-2.5"
        >
          <AlertTriangle
            className={cn(
              "mt-0.5 h-4 w-4 shrink-0",
              f.severity === "HIGH" ? "text-loss" : "text-coach",
            )}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {BEHAVIOURS[f.code].label}
              <span
                className={cn(
                  "rounded-full border px-2 text-[11px] font-normal",
                  SEVERITY[f.severity],
                )}
              >
                {f.severity.toLowerCase()}
              </span>
            </p>
            <p className="mt-0.5 text-sm text-ink-muted">{f.evidence}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
