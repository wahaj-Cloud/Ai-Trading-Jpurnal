import type { Impact } from "@atc/shared";
import { cn } from "@/lib/cn";

/** Impact as three bars, like the classic calendars: red high, orange medium, yellow low. */
export const IMPACT_STYLE: Record<Impact, { label: string; color: string; bars: number }> = {
  HIGH: { label: "High", color: "#ef4444", bars: 3 },
  MEDIUM: { label: "Medium", color: "#f59e0b", bars: 2 },
  LOW: { label: "Low", color: "#eab308", bars: 1 },
  NONE: { label: "None", color: "#7d8bb3", bars: 0 },
};

export function ImpactBadge({ impact, showLabel = true }: { impact: Impact; showLabel?: boolean }) {
  const s = IMPACT_STYLE[impact];
  return (
    <span className="inline-flex items-center gap-1.5" title={`${s.label} impact`}>
      <span className="flex items-end gap-[2px]" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn("w-[4px] rounded-[1.5px]", i < s.bars ? "" : "opacity-25")}
            style={{
              height: 6 + i * 3,
              background: i < s.bars ? s.color : "var(--color-ink-faint)",
            }}
          />
        ))}
      </span>
      {showLabel ? (
        <span
          className="text-[11px] font-semibold tracking-wide uppercase"
          style={{ color: s.color }}
        >
          {s.label}
        </span>
      ) : (
        <span className="sr-only">{s.label} impact</span>
      )}
    </span>
  );
}
