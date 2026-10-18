import type { BillingDto } from "@atc/shared";
import { Plans } from "@/features/billing/plans";
import { AutoRefresh } from "@/features/labs/backtest-views";
import { apiFetch } from "@/lib/api";

export const metadata = { title: "Plan and billing" };

const dateFmt = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; crypto?: string }>;
}) {
  const [billing, { plan, crypto }] = await Promise.all([
    apiFetch<BillingDto>("/v1/billing"),
    searchParams,
  ]);
  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Plan and billing</h1>
        <p className="mt-1 text-sm text-ink-muted">
          You are on the {billing.plan.name} plan
          {billing.status === "PAST_DUE" ? " (payment overdue: update your card to keep it)" : ""}
          {billing.currentPeriodEnd
            ? billing.cancelAtPeriodEnd
              ? `, ending on ${dateFmt.format(new Date(billing.currentPeriodEnd))}.`
              : `, renewing on ${dateFmt.format(new Date(billing.currentPeriodEnd))}.`
            : "."}
          {billing.manualPlan ? " This plan was set up for you by our team." : ""}
          {billing.crypto.paidUntil ? " Paid with crypto (does not renew by itself)." : ""}
        </p>
      </header>
      {crypto === "paid" && (
        <p
          role="status"
          className="rounded-[var(--radius-control)] border border-profit/40 bg-profit/10 p-3 text-sm"
        >
          Thank you! Your crypto payment is on its way. Your plan updates automatically once the
          network confirms it, usually within 2 to 20 minutes. This page refreshes by itself.
        </p>
      )}
      {crypto === "cancelled" && (
        <p role="status" className="text-sm text-ink-muted">
          The crypto payment was cancelled. Nothing was charged.
        </p>
      )}
      {(crypto === "paid" || billing.crypto.pending) && <AutoRefresh every={20_000} />}
      <Plans billing={billing} highlight={plan} />
      <p className="text-xs text-ink-faint">
        Card payments are processed by Paddle, our reseller, which handles taxes and invoices;
        crypto payments by NOWPayments. We never see your card details or your wallet keys.
      </p>
    </div>
  );
}
