import type { BillingDto } from "@atc/shared";
import { Plans } from "@/features/billing/plans";
import { apiFetch } from "@/lib/api";

export const metadata = { title: "Plan and billing" };

const dateFmt = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export default async function BillingPage() {
  const billing = await apiFetch<BillingDto>("/v1/billing");
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
        </p>
      </header>
      <Plans billing={billing} />
      <p className="text-xs text-ink-faint">
        Payments are processed by Paddle, our reseller, which handles taxes and invoices. We never
        see your card details.
      </p>
    </div>
  );
}
