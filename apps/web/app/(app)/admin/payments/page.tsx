import type { AdminPaymentsDto } from "@atc/shared";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

export const metadata = { title: "Admin · Payments" };

const OUTCOME_HELP: Record<string, string> = {
  APPLIED: "Plan updated",
  IGNORED_TYPE: "Recorded",
  IGNORED_STALE: "Older than the latest update (skipped safely)",
  IGNORED_MANUAL: "Plan was granted by support, left unchanged",
  IGNORED_UNKNOWN_USER: "No matching account: find the customer and grant the plan",
  IGNORED_CONFLICT:
    "Not linked (another live subscription, or the account could not be proven): check the customer",
  IGNORED_UNKNOWN_PRICE: "Price ID not in PADDLE_PRICES: add it on Railway",
  PROCESSING: "Still processing or failed mid-way: re-send it from Paddle",
  RECORDED: "Recorded (crypto payment in progress)",
  NEEDS_REVIEW:
    "Crypto: partial payment, refund, or paid while a card plan was active: check in NOWPayments",
  IGNORED_MISMATCH: "Crypto amount or currency did not match the order: check in NOWPayments",
  IGNORED_UNKNOWN_ORDER: "Crypto payment for an unknown order",
};

const fmt = (v: string, currency: string) => {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(Number(v));
  } catch {
    return `${v} ${currency}`;
  }
};

/** Every Paddle event we received, problems first in mind: a payment must always end in a plan. */
export default async function AdminPayments({
  searchParams,
}: {
  searchParams: Promise<{ problems?: string; cursor?: string }>;
}) {
  const p = await searchParams;
  const problems = p.problems === "true";
  const cursor = p.cursor && /^[0-9a-f-]{36}$/i.test(p.cursor) ? p.cursor : undefined;
  const data = await apiFetch<AdminPaymentsDto>(
    `/v1/admin/payments?${new URLSearchParams({ problems: String(problems), ...(cursor ? { cursor } : {}) })}`,
  );
  const ts = (s: string) => s.slice(0, 16).replace("T", " ");

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        {data.revenue30d.length === 0 ? (
          <div className="surface rounded-[var(--radius-surface)] p-4 text-sm text-ink-muted sm:col-span-2">
            No completed payments in the last 30 days.
          </div>
        ) : (
          data.revenue30d.map((r) => (
            <div
              key={`${r.method}${r.currency}`}
              className="surface rounded-[var(--radius-surface)] p-4"
            >
              <p className="text-xs text-ink-faint">
                Paid by {r.method}, last 30 days ({r.currency})
              </p>
              <p className="figures text-2xl font-semibold">{fmt(r.total, r.currency)}</p>
              <p className="text-xs text-ink-muted">
                {r.payments} payment{r.payments === 1 ? "" : "s"}
                {r.earnings !== null && ` · you receive ${fmt(r.earnings, r.currency)} after fees`}
                {r.method === "crypto" && " · sent to your wallet (≈0.5–1% gateway fee)"}
              </p>
            </div>
          ))
        )}
        <div
          className={cn(
            "surface rounded-[var(--radius-surface)] p-4",
            data.problems30d > 0 && "border border-loss/50",
          )}
        >
          <p className="text-xs text-ink-faint">Needs attention, last 30 days</p>
          <p className={cn("figures text-2xl font-semibold", data.problems30d > 0 && "text-loss")}>
            {data.problems30d}
          </p>
          <Link
            href={`/admin/payments?problems=${!problems}`}
            className="text-xs text-coach underline-offset-4 hover:underline"
          >
            {problems ? "Show all events" : "Show only these"}
          </Link>
        </div>
      </div>

      <ul className="grid gap-1 text-sm">
        {data.items.length === 0 && <li className="text-ink-muted">Nothing here.</li>}
        {data.items.map((r) => (
          <li
            key={r.id}
            className={cn(
              "surface grid gap-0.5 rounded-[var(--radius-control)] px-3 py-2",
              r.problem && "border border-loss/50",
            )}
          >
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="figures text-xs text-ink-faint">{ts(r.occurredAt)}</span>
              <span className="font-medium">{r.type}</span>
              {r.amount && (
                <span className="figures">{fmt(r.amount.total, r.amount.currency)}</span>
              )}
              <span className="text-ink-muted">{r.userEmail ?? "no account"}</span>
            </div>
            <div className="flex flex-wrap gap-x-3 text-xs">
              <span className={r.problem ? "text-loss" : "text-ink-muted"}>
                {OUTCOME_HELP[r.outcome] ?? r.outcome}
              </span>
              {r.customerId && <span className="figures text-ink-faint">{r.customerId}</span>}
              {r.subscriptionId && (
                <span className="figures text-ink-faint">{r.subscriptionId}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {data.nextCursor && (
        <Link
          href={`/admin/payments?problems=${problems}&cursor=${data.nextCursor}`}
          className="text-sm text-coach underline-offset-4 hover:underline"
        >
          Older
        </Link>
      )}
    </>
  );
}
