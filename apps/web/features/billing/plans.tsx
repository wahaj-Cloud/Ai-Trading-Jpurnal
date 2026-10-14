"use client";

import type { BillingDto, BillingInterval, PlanOfferDto } from "@atc/shared";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { changePlanAction, openPortalAction } from "./actions";

declare global {
  interface Window {
    Paddle?: {
      Environment: { set(env: string): void };
      Initialize(opts: { token: string; eventCallback?: (e: { name?: string }) => void }): void;
      Checkout: { open(opts: Record<string, unknown>): void };
      PricePreview(opts: { items: { priceId: string; quantity: number }[] }): Promise<{
        data: {
          details: { lineItems: { price: { id: string }; formattedTotals: { total: string } }[] };
        };
      }>;
    };
  }
}

const TOKEN = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? "";
const PADDLE_ENV = process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT ?? "sandbox";

const limit = (n: number, unit: string) =>
  n === -1 ? `Unlimited ${unit}` : `${n.toLocaleString("en")} ${unit}`;

function features(o: PlanOfferDto): string[] {
  return [
    limit(
      o.limits.exchangeAccounts,
      o.limits.exchangeAccounts === 1 ? "exchange connection" : "exchange connections",
    ),
    limit(o.limits.aiReviewsPerMonth, "AI trade reviews a month"),
    limit(o.limits.coachMessagesPerDay, "coach questions a day"),
    o.limits.historyDays === -1
      ? "Full history"
      : `${o.limits.historyDays} days of analytics history`,
    ...(o.limits.brokerAccounts === 0
      ? []
      : [
          limit(
            o.limits.brokerAccounts,
            o.limits.brokerAccounts === 1
              ? "Exness (MetaTrader) account"
              : "Exness (MetaTrader) accounts",
          ),
        ]),
    `${limit(o.limits.setups, o.limits.setups === 1 ? "setup alert" : "setup alerts")}${o.limits.setupAlertEmail === 1 ? " (in-app + email)" : " (in-app)"}`,
    o.limits.whatIf === 1
      ? "What-If Lab: replay your trades with your rules"
      : "What-If Lab preview",
    ...(o.limits.backtestRunsPerMonth === 0
      ? []
      : [
          `Strategy Lab: ${limit(o.limits.backtestRunsPerMonth, "backtests a month")}${o.limits.backtestHistoryMonths > 0 ? `, ${o.limits.backtestHistoryMonths} months of history` : ""}`,
        ]),
    o.limits.marketPulseCoins === -1
      ? "Market Pulse: every coin, 24h / 7d / 30d"
      : `Market Pulse: top ${o.limits.marketPulseCoins} coins, 24h`,
  ];
}

/** Plan cards with Paddle checkout (loaded only on this page) and the billing portal. */
export function Plans({
  billing,
  highlight,
}: {
  billing: BillingDto;
  /** Plan the visitor picked on the pricing section before signing up. */
  highlight?: string;
}) {
  const router = useRouter();
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [ready, setReady] = useState(false);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const loaded = useRef(false);
  const canCheckout = billing.checkoutEnabled && TOKEN !== "" && !billing.manualPlan;

  useEffect(() => {
    if (!canCheckout || loaded.current) return;
    loaded.current = true;
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.async = true;
    script.onload = () => {
      const P = window.Paddle;
      if (!P) return;
      if (PADDLE_ENV === "sandbox") P.Environment.set("sandbox");
      P.Initialize({
        token: TOKEN,
        eventCallback: (e) => {
          if (e.name === "checkout.completed") {
            setMessage("Payment received. Your plan updates within a minute.");
            setTimeout(() => router.refresh(), 5_000);
          }
        },
      });
      setReady(true);
      const items = billing.offers.flatMap((o) =>
        o.prices.map((p) => ({ priceId: p.priceId, quantity: 1 })),
      );
      if (items.length)
        P.PricePreview({ items })
          .then((r) =>
            setPrices(
              Object.fromEntries(
                r.data.details.lineItems.map((li) => [li.price.id, li.formattedTotals.total]),
              ),
            ),
          )
          .catch(() => undefined);
    };
    document.head.appendChild(script);
  }, [canCheckout, billing.offers, router]);

  const checkout = (priceId: string) =>
    window.Paddle?.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customer: { email: billing.email },
      customData: { userId: billing.userId },
    });
  const changePlan = (priceId: string, name: string) => {
    if (
      !window.confirm(
        `Switch your subscription to ${name}? Paddle charges or credits the difference now.`,
      )
    )
      return;
    start(async () => {
      const res = await changePlanAction(priceId);
      if (res.error) setMessage(res.error);
      else {
        setMessage("Plan change requested. Your plan updates within a minute.");
        setTimeout(() => router.refresh(), 5_000);
      }
    });
  };
  const hasYearly = billing.offers.some((o) => o.prices.some((p) => p.interval === "year"));

  return (
    <div className="grid gap-6">
      {hasYearly && (
        <fieldset className="flex gap-1 self-start">
          <legend className="sr-only">Billing interval</legend>
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={interval === i}
              onClick={() => setInterval(i)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                interval === i ? "border-coach text-ink" : "border-rule text-ink-muted",
              )}
            >
              {i === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </fieldset>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {billing.offers
          .filter((o) => o.code !== "ENTERPRISE")
          .map((o) => {
            const price = o.prices.find((p) => p.interval === interval) ?? o.prices[0];
            // With an online subscription the exact price (plan and interval) is what is current.
            const current = billing.hasOnlineSubscription
              ? price?.priceId === billing.currentPriceId
              : o.code === billing.plan.code;
            const picked = !current && o.code === highlight;
            return (
              <section
                key={o.code}
                aria-label={`${o.name} plan`}
                className={cn(
                  "flex flex-col rounded-[var(--radius-surface)] border bg-panel p-5",
                  current ? "border-coach" : "border-rule",
                  picked && "border-coach shadow-[0_0_0_1px_var(--color-coach)_inset]",
                )}
              >
                {picked && (
                  <p className="mb-2 w-fit rounded-full bg-coach/15 px-2.5 py-0.5 text-xs font-medium text-coach">
                    The plan you picked
                  </p>
                )}
                <h2 className="font-semibold">{o.name}</h2>
                <p className="figures mt-1 text-2xl font-semibold">
                  {o.code === "FREE"
                    ? "Free"
                    : price
                      ? (prices[price.priceId] ?? "See price at checkout")
                      : "—"}
                  {price && prices[price.priceId] && (
                    <span className="text-sm font-normal text-ink-muted"> / {price.interval}</span>
                  )}
                </p>
                <ul className="mt-4 grid flex-1 gap-2 text-sm text-ink-muted">
                  {features(o).map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-profit" aria-hidden="true" />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-5">
                  {current ? (
                    <p className="text-sm text-coach">Your current plan</p>
                  ) : o.code !== "FREE" && price && billing.hasOnlineSubscription ? (
                    <Button
                      type="button"
                      disabled={pending}
                      onClick={() => changePlan(price.priceId, `${o.name} (${price.interval}ly)`)}
                      className="w-full"
                    >
                      {o.code === billing.plan.code
                        ? `Switch to ${price.interval}ly billing`
                        : `Switch to ${o.name}`}
                    </Button>
                  ) : o.code === "FREE" && billing.hasOnlineSubscription ? (
                    <p className="text-sm text-ink-muted">Cancel in “Manage billing” below</p>
                  ) : o.code !== "FREE" && price && canCheckout ? (
                    <Button
                      type="button"
                      disabled={!ready}
                      onClick={() => checkout(price.priceId)}
                      className="w-full"
                    >
                      {`Upgrade to ${o.name}`}
                    </Button>
                  ) : null}
                </div>
              </section>
            );
          })}
      </div>
      {!canCheckout && !billing.manualPlan && (
        <p className="text-sm text-ink-muted">
          Online payments are not switched on yet. Contact support to upgrade.
        </p>
      )}
      {billing.hasBillingAccount && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await openPortalAction();
                if (res?.error) setMessage(res.error);
              })
            }
          >
            {pending ? "Opening…" : "Manage billing, invoices and cancellation"}
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="text-sm text-ink">
          {message}
        </p>
      )}
    </div>
  );
}
