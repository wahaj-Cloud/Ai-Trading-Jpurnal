import { type FlowStrength, STRENGTH_LABEL } from "@atc/shared";
import { cn } from "@/lib/cn";

/** Colour and arrow per strength: two arrows for strong, a dot for neutral. */
export const STRENGTH_STYLE: Record<FlowStrength, { mark: string; cls: string; cell: string }> = {
  strong_buying: { mark: "▲▲", cls: "bg-profit/25 text-profit", cell: "bg-profit/45 text-ink" },
  buying: { mark: "▲", cls: "bg-profit/12 text-profit", cell: "bg-profit/20 text-profit" },
  neutral: { mark: "•", cls: "bg-hi/[0.07] text-ink-muted", cell: "bg-hi/[0.04] text-ink-faint" },
  selling: { mark: "▼", cls: "bg-loss/12 text-loss", cell: "bg-loss/20 text-loss" },
  strong_selling: { mark: "▼▼", cls: "bg-loss/25 text-loss", cell: "bg-loss/45 text-ink" },
};

export function StrengthBadge({
  strength,
  compact = false,
  className,
}: {
  strength: FlowStrength;
  compact?: boolean;
  className?: string;
}) {
  const s = STRENGTH_STYLE[strength];
  return (
    <span
      title={STRENGTH_LABEL[strength]}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-semibold whitespace-nowrap",
        s.cls,
        className,
      )}
    >
      <span aria-hidden="true">{s.mark}</span>
      {compact ? (
        <span className="sr-only">{STRENGTH_LABEL[strength]}</span>
      ) : (
        STRENGTH_LABEL[strength]
      )}
    </span>
  );
}
