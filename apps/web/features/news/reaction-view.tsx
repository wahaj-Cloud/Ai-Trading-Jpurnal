"use client";

import type { EconomicEventDto } from "@atc/shared";
import { cn } from "@/lib/cn";
import { useLiveEvent } from "./live-news";
import { type MarketMove, marketReaction } from "./reaction";

const ARROW = { up: "▲", down: "▼", mixed: "◆" } as const;
const TONE = { up: "text-profit", down: "text-loss", mixed: "text-ink-muted" } as const;

function Moves({ moves }: { moves: MarketMove[] }) {
  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">
      {moves.map((m) => (
        <span key={m.market} className="whitespace-nowrap">
          {m.market}{" "}
          <span className={cn("font-semibold", TONE[m.dir])}>
            {ARROW[m.dir]}
            <span className="sr-only">
              {m.dir === "up" ? " up" : m.dir === "down" ? " down" : ""}
            </span>
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * "Above 0.3%: USD ▲ Crypto ▼ Gold ▼ · Below 0.3%: USD ▼ Crypto ▲ Gold ▲" — the usual first
 * reaction to each outcome. Once the actual is out, the scenario that happened is highlighted.
 */
export function ReactionHint({
  event,
  showWhy = false,
  className,
}: {
  event: EconomicEventDto;
  showWhy?: boolean;
  className?: string;
}) {
  // Picks up the actual figure the moment it is released.
  const r = marketReaction(useLiveEvent(event));
  const row = (label: string, moves: MarketMove[], hit: boolean) => (
    <span
      className={cn(
        "inline-flex flex-wrap items-baseline gap-x-1.5",
        hit && "rounded bg-coach/15 px-1 text-ink",
      )}
    >
      <span className="text-ink-faint">{label}:</span>
      <Moves moves={moves} />
    </span>
  );
  return (
    <div className={cn("grid gap-0.5 text-xs text-ink-muted", className)}>
      {showWhy && <p>{r.why}</p>}
      <p className="flex flex-wrap gap-x-4 gap-y-0.5">
        {row(r.higherLabel, r.higher, r.outcome === "higher")}
        {row(r.lowerLabel, r.lower, r.outcome === "lower")}
      </p>
    </div>
  );
}
