"use client";

import { EXCHANGE_CATALOG, EXCHANGE_IDS, type ExchangeId } from "@atc/shared";
import { Check, Lock } from "lucide-react";
import Link from "next/link";
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
  brokerSlotsLeft = -1,
  brokerIncluded = true,
}: {
  connectedCounts: Partial<Record<ExchangeId, number>>;
  /** -1 means unlimited. */
  slotsLeft: number;
  /** MetaTrader (Exness) connections the plan still allows; -1 means unlimited. */
  brokerSlotsLeft?: number;
  /** False when the plan has no Exness allowance at all (upgrade needed, not just a full slot). */
  brokerIncluded?: boolean;
}) {
  const [picked, setPicked] = useState<ExchangeId[]>([]);
  const isBroker = (id: ExchangeId) => EXCHANGE_CATALOG[id].kind === "METATRADER";
  // Crypto exchanges and Exness are counted against separate allowances.
  const cryptoPicked = picked.filter((id) => !isBroker(id)).length;
  const brokerPicked = picked.length - cryptoPicked;
  const full = slotsLeft !== -1 && cryptoPicked >= slotsLeft;
  const brokerFull = brokerSlotsLeft !== -1 && brokerPicked >= brokerSlotsLeft;
  const blocked = (id: ExchangeId) => (isBroker(id) ? brokerFull : full);

  const toggle = (id: ExchangeId) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : blocked(id) ? p : [...p, id]));

  return (
    <form method="get" action="/exchanges/connect/start" className="grid gap-6">
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">Exchanges to connect</legend>
        {EXCHANGE_IDS.map((id) => {
          const info = EXCHANGE_CATALOG[id];
          const checked = picked.includes(id);
          const locked = info.kind === "METATRADER" && !brokerIncluded;
          const disabled = (!checked && blocked(id)) || locked;
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
                {locked && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-coach/15 px-2 py-0.5 text-xs font-medium text-coach">
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    Pro and Premium
                  </span>
                )}
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

      {!brokerIncluded && (
        <p className="text-sm text-ink-muted">
          Exness (MetaTrader) syncing runs a dedicated cloud terminal for your account, so it is
          included with the Pro and Premium plans.{" "}
          <Link href="/billing" className="text-coach underline-offset-4 hover:underline">
            See plans
          </Link>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={picked.length === 0}>
          {picked.length > 1 ? `Connect ${picked.length} exchanges` : "Continue"}
        </Button>
        <p className="text-sm text-ink-muted" role="status">
          {slotsLeft === -1
            ? "Pick as many as you use. You will add each connection in turn."
            : slotsLeft === 0
              ? "Your crypto exchange connections are all in use. You can still add Exness."
              : full
                ? `That uses all ${slotsLeft} exchange connection${slotsLeft === 1 ? "" : "s"} left on your plan.`
                : `You can pick up to ${slotsLeft} exchange${slotsLeft === 1 ? "" : "s"}. You will add each connection in turn.`}
        </p>
      </div>
    </form>
  );
}
