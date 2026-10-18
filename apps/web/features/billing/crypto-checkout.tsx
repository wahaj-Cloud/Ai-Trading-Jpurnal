"use client";

import type { BillingDto, BillingInterval } from "@atc/shared";
import { Bitcoin } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cryptoCheckoutAction } from "./actions";

const dateFmt = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
const PLAN_NAME = { PRO: "Pro", PREMIUM: "Premium" } as const;
const STATUS_TEXT: Record<string, string> = {
  WAITING: "waiting for your transfer",
  CONFIRMING: "received, waiting for network confirmations",
  PARTIAL: "only part of the amount arrived: contact support",
};

/**
 * Pay with crypto (USDT, BTC, ETH and 300+ coins) through NOWPayments. Crypto cannot renew by
 * itself, so each payment buys 1 month or 1 year; renewing early adds to the time left.
 */
export function CryptoCheckout({
  billing,
  interval,
}: {
  billing: BillingDto;
  interval: BillingInterval;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const c = billing.crypto;
  if (!c.enabled || billing.manualPlan) return null;
  const cardActive = billing.hasOnlineSubscription;
  const prices = c.prices.filter((p) => p.interval === interval);

  return (
    <section
      aria-labelledby="crypto-heading"
      className="grid gap-4 rounded-[var(--radius-surface)] border border-rule bg-panel p-5"
    >
      <div>
        <h2 id="crypto-heading" className="flex items-center gap-2 font-semibold">
          <Bitcoin className="h-4 w-4 text-[#f7931a]" aria-hidden="true" />
          Pay with crypto
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          USDT (TRC20, BEP20, ERC20), BTC, ETH, SOL and 300+ coins. Crypto does not renew by itself:
          you pay for {interval === "year" ? "a year" : "a month"} at a time and we remind you
          before it ends. Paying again early adds to the time you have left.
        </p>
      </div>

      {c.paidUntil && (
        <p className="text-sm">
          Paid with crypto until{" "}
          <span className="font-medium">{dateFmt.format(new Date(c.paidUntil))}</span>.
        </p>
      )}
      {c.pending && (
        <p role="status" className="text-sm text-[#f5b84d]">
          Your {PLAN_NAME[c.pending.plan as "PRO" | "PREMIUM"] ?? c.pending.plan} payment is{" "}
          {STATUS_TEXT[c.pending.status] ?? "being processed"}. Your plan updates automatically once
          it is confirmed (usually 2 to 20 minutes).
        </p>
      )}

      {cardActive ? (
        <p className="text-sm text-ink-muted">
          You pay by card now. To switch to crypto, cancel the card subscription first in “Manage
          billing”; you keep your plan until the paid period ends.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {prices.map((p) => (
            <Button
              key={`${p.plan}${p.interval}`}
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const res = await cryptoCheckoutAction(p.plan, p.interval);
                  if (res?.error) setError(res.error);
                })
              }
            >
              {PLAN_NAME[p.plan]} · {p.interval === "year" ? "1 year" : "1 month"} · ${p.usd}
            </Button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      )}
      <p className="text-xs text-ink-faint">
        Processed by NOWPayments. Send the exact amount on the network shown; a wrong network or a
        partial amount cannot be credited automatically.
      </p>
    </section>
  );
}
