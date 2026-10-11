"use client";

import { EXCHANGE_CATALOG, EXCHANGE_IDS, type ExchangeId } from "@atc/shared";
import { Check } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ExchangeMark } from "./exchange-mark";

/**
 * Pick one or several exchanges, then connect them one after another.
 * Works without JavaScript (plain GET form); with it, selection is capped at the plan's free slots.
 */
export function ExchangePicker({
  connectedCounts,
  slotsLeft,
}: {
  connectedCounts: Partial<Record<ExchangeId, number>>;
  /** -1 means unlimited. */
  slotsLeft: number;
}) {
  const [picked, setPicked] = useState<ExchangeId[]>([]);
  const full = slotsLeft !== -1 && picked.length >= slotsLeft;

  const toggle = (id: ExchangeId) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : full ? p : [...p, id]));

  return (
    <form method="get" action="/exchanges/connect/start" className="grid gap-6">
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">Exchanges to connect</legend>
        {EXCHANGE_IDS.map((id) => {
          const info = EXCHANGE_CATALOG[id];
          const checked = picked.includes(id);
          const disabled = !checked && full;
          const count = connectedCounts[id] ?? 0;
          return (
            <label
              key={id}
              className={cn(
                "relative flex cursor-pointer items-center gap-4 rounded-[var(--radius-surface)] border bg-panel p-4 transition-colors",
                checked ? "border-coach" : "border-rule hover:border-ink-faint",
                disabled && "cursor-not-allowed opacity-50 hover:border-rule",
              )}
            >
              <input
                type="checkbox"
                name="x"
                value={id}
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(id)}
                className="peer sr-only"
              />
              <ExchangeMark exchange={id} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{info.name}</span>
                <span className="block text-sm text-ink-muted">
                  {info.product}
                  {count > 0 ? `, ${count} connected` : ""}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border",
                  checked ? "border-coach bg-coach text-coach-ink" : "border-rule",
                )}
              >
                {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
              <span className="pointer-events-none absolute inset-0 rounded-[var(--radius-surface)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-coach)]" />
            </label>
          );
        })}
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={picked.length === 0}>
          {picked.length > 1 ? `Connect ${picked.length} exchanges` : "Continue"}
        </Button>
        <p className="text-sm text-ink-muted" role="status">
          {slotsLeft === -1
            ? "Pick as many as you use. You will add each connection in turn."
            : full
              ? `That uses all ${slotsLeft} connection${slotsLeft === 1 ? "" : "s"} left on your plan.`
              : `You can pick up to ${slotsLeft}. You will add each connection in turn.`}
        </p>
      </div>
    </form>
  );
}
