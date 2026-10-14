import type { AdminCostsDto } from "@atc/shared";
import Link from "next/link";
import { PlanLimitsForm } from "@/features/admin/forms";
import { Panel } from "@/features/analytics/metric";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

export const metadata = { title: "Admin · Costs" };

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function shift(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

function MarginBadge({ value, target }: { value: number | null; target: number }) {
  if (value === null) return <span className="text-ink-faint">—</span>;
  const tone = value >= target ? "text-profit" : value >= 0.5 ? "text-[#f59e0b]" : "text-loss";
  return <span className={cn("figures font-semibold", tone)}>{pct(value)}</span>;
}

/**
 * What the business spends to serve each plan against what the plan earns, so limits can be
 * tuned before heavy users eat the margin. AI cost is measured per call; MetaApi and payment
 * fees are estimates from the assumptions shown.
 */
export default async function AdminCostsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: m } = await searchParams;
  const current = new Date().toISOString().slice(0, 7);
  const month = m && MONTH.test(m) && m <= current ? m : current;
  const data = await apiFetch<AdminCostsDto>(`/v1/admin/costs?month=${month}`);
  const { totals, targetMarginPct: target, assumptions: a } = data;
  const missingPrices = data.plans.filter(
    (p) => p.code !== "FREE" && p.code !== "ENTERPRISE" && p.priceUsd === null,
  );
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleString("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Costs & margins · {label}</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            Target gross margin {pct(target)}: what is left of a plan's price after AI, MetaApi
            (Exness) and payment fees. Fixed hosting costs are not included. AI spend is tracked
            from the v16 release onwards.
          </p>
        </div>
        <nav aria-label="Month" className="flex gap-2 text-sm">
          <Link
            href={`/admin/costs?month=${shift(month, -1)}`}
            className="rounded-full border border-rule px-3 py-1 hover:bg-raised"
          >
            ‹ Previous
          </Link>
          {month < current && (
            <Link
              href={`/admin/costs?month=${shift(month, 1)}`}
              className="rounded-full border border-rule px-3 py-1 hover:bg-raised"
            >
              Next ›
            </Link>
          )}
        </nav>
      </header>

      {missingPrices.length > 0 && (
        <p className="rounded-[var(--radius-control)] border border-[#f59e0b]/40 bg-[#f59e0b]/10 px-4 py-3 text-sm">
          Set the monthly price of {missingPrices.map((p) => p.name).join(" and ")} below so revenue
          and margins can be calculated.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[
          ["Est. revenue", usd(totals.revenueUsd)],
          ["AI cost", usd(totals.aiCostUsd)],
          ["MetaApi (est.)", usd(totals.metaapiCostUsd)],
          ["Payment fees (est.)", usd(totals.paymentFeesUsd)],
          ["Gross margin", null],
        ].map(([k, v]) => (
          <div key={k} className="surface rounded-[var(--radius-surface)] p-4">
            <p className="text-xs text-ink-muted">{k}</p>
            <p className="figures pop-text mt-1 text-xl font-semibold">
              {v ?? <MarginBadge value={totals.marginPct} target={target} />}
            </p>
          </div>
        ))}
      </div>

      <Panel title="By plan">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs text-ink-muted">
                {[
                  "Plan",
                  "Price",
                  "Users",
                  "Revenue",
                  "AI cost",
                  "AI / user",
                  "Exness",
                  "MetaApi",
                  "Fees",
                  "Margin",
                ].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={cn("py-2 pr-3 font-medium", i > 0 && "text-right")}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.plans.map((p) => (
                <tr key={p.code} className="border-b border-rule/50 last:border-0">
                  <th scope="row" className="py-2.5 pr-3 text-left font-medium">
                    {p.name}
                  </th>
                  <td className="figures py-2.5 pr-3 text-right">
                    {p.priceUsd === null ? "—" : usd(p.priceUsd)}
                  </td>
                  <td className="figures py-2.5 pr-3 text-right">{p.users}</td>
                  <td className="figures py-2.5 pr-3 text-right">{usd(p.revenueUsd)}</td>
                  <td className="figures py-2.5 pr-3 text-right">{usd(p.aiCostUsd)}</td>
                  <td className="figures py-2.5 pr-3 text-right text-ink-muted">
                    {p.users ? usd(p.aiCostUsd / p.users) : "—"}
                  </td>
                  <td className="figures py-2.5 pr-3 text-right">{p.brokerAccounts}</td>
                  <td className="figures py-2.5 pr-3 text-right">{usd(p.metaapiCostUsd)}</td>
                  <td className="figures py-2.5 pr-3 text-right">{usd(p.paymentFeesUsd)}</td>
                  <td className="py-2.5 text-right">
                    <MarginBadge value={p.marginPct} target={target} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-faint">
          Assumptions: MetaApi {usd(a.metaapiUsdPerAccount)} per Exness account per month (set
          METAAPI_ACCOUNT_USD on the API to change it), payment fees{" "}
          {Math.round(a.paymentPct * 100)}% + {usd(a.paymentFixedUsd)} per payment. Revenue uses
          list prices, without discounts or yearly billing.
        </p>
      </Panel>

      <Panel title="Most expensive users this month">
        {data.topUsers.length === 0 ? (
          <p className="text-sm text-ink-muted">No AI or Exness costs recorded this month yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-rule text-left text-xs text-ink-muted">
                  {["User", "Plan", "AI cost", "AI budget used", "Exness", "Margin"].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={cn("py-2 pr-3 font-medium", i > 1 && "text-right")}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.topUsers.map((u) => (
                  <tr key={u.id} className="border-b border-rule/50 last:border-0">
                    <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                      <Link href={`/admin/users/${u.id}`} className="hover:underline">
                        {u.email}
                      </Link>
                      {u.foundingMember && (
                        <span className="ml-2 rounded-full bg-coach/15 px-1.5 py-px text-[10px] text-coach">
                          founding
                        </span>
                      )}
                    </th>
                    <td className="py-2.5 pr-3">
                      {u.plan.charAt(0) + u.plan.slice(1).toLowerCase()}
                    </td>
                    <td className="figures py-2.5 pr-3 text-right">{usd(u.aiCostUsd)}</td>
                    <td
                      className={cn(
                        "figures py-2.5 pr-3 text-right",
                        u.budgetUsedPct !== null &&
                          u.budgetUsedPct >= 0.9 &&
                          "font-semibold text-loss",
                      )}
                    >
                      {u.budgetUsedPct === null ? "unlimited" : pct(u.budgetUsedPct)}
                    </td>
                    <td className="figures py-2.5 pr-3 text-right">{u.brokerAccounts}</td>
                    <td className="py-2.5 text-right">
                      <MarginBadge value={u.marginPct} target={target} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Plan prices and limits">
        <p className="mb-5 text-sm text-ink-muted">
          Changes apply to everyone on the plan straight away. Keep each plan's AI budget under a
          quarter of its price to hold a {pct(target)} margin. The price here is only for this page;
          what customers pay is set in Paddle.
        </p>
        <div className="grid gap-6">
          {data.plans.map((p) => (
            <section key={p.code} aria-label={p.name} className="grid gap-2">
              <h3 className="text-sm font-semibold">{p.name}</h3>
              <PlanLimitsForm plan={p} />
            </section>
          ))}
        </div>
      </Panel>
    </div>
  );
}
