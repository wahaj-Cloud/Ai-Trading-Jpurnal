import { Star } from "lucide-react";

/** Shown to early supporters who joined through the founding-member offer. */
export function FoundingBadge() {
  return (
    <span
      title="Founding member: one of WickMentor's first supporters"
      className="inline-flex items-center gap-1 rounded-full border border-[#f5c451]/50 bg-[linear-gradient(180deg,rgba(245,196,81,0.22),rgba(245,196,81,0.08))] px-2.5 py-0.5 align-middle text-xs font-semibold text-[#f5c451] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
    >
      <Star className="h-3 w-3 fill-current" aria-hidden="true" />
      Founding member
    </span>
  );
}
