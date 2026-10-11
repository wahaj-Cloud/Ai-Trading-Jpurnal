import type { AdminOverviewDto } from "@atc/shared";
import { Panel } from "@/features/analytics/metric";
import { apiFetch } from "@/lib/api";

export const metadata = { title: "Admin" };

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-surface)] border border-rule bg-panel p-4">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="figures mt-1 text-2xl font-semibold">
        {typeof value === "number" ? value.toLocaleString("en") : value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

export default async function AdminOverview() {
  const o = await apiFetch<AdminOverviewDto>("/v1/admin/overview");
  const paid = o.subscriptions
    .filter((s) => s.plan !== "FREE" && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(s.status))
    .reduce((s, x) => s + x.count, 0);
  const maxSignup = Math.max(...o.signups.map((s) => s.count), 1);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Users"
          value={o.users.total}
          hint={`${o.users.new7d} new this week · ${o.users.suspended} suspended`}
        />
        <Stat label="Paying subscriptions" value={paid} />
        <Stat
          label="Sync runs (24 h)"
          value={o.sync.runs24h}
          hint={`${o.sync.failed24h} failed · ${o.sync.failingAccounts} accounts need attention`}
        />
        <Stat
          label="AI this month"
          value={o.ai.reviewsThisMonth}
          hint={`reviews · ${o.ai.notesThisMonth} notes · ${o.ai.messagesThisMonth} chats · ${(o.ai.tokensThisMonth / 1000).toFixed(0)}k tokens`}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Sign-ups (30 days)" className="lg:col-span-2">
          {o.signups.length ? (
            <ul className="grid gap-1 text-sm">
              {o.signups.map((s) => (
                <li key={s.date} className="grid grid-cols-[6rem_1fr_3rem] items-center gap-3">
                  <span className="figures text-xs text-ink-muted">{s.date}</span>
                  <span
                    className="h-2 rounded-full bg-coach/70"
                    style={{ width: `${(s.count / maxSignup) * 100}%` }}
                    aria-hidden="true"
                  />
                  <span className="figures text-right text-xs">{s.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">No sign-ups in the last 30 days.</p>
          )}
        </Panel>
        <Panel title="Trades synced">
          <p className="figures text-2xl font-semibold">{o.trades.total.toLocaleString("en")}</p>
          <p className="text-xs text-ink-muted">
            {o.trades.last24h.toLocaleString("en")} in the last 24 hours
          </p>
        </Panel>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Subscriptions">
          <table className="w-full text-sm">
            <tbody>
              {o.subscriptions.map((s) => (
                <tr key={`${s.plan}-${s.status}`} className="border-b border-rule/60 last:border-0">
                  <td className="py-1.5">{s.plan}</td>
                  <td className="py-1.5 text-ink-muted">{s.status.toLowerCase()}</td>
                  <td className="figures py-1.5 text-right">{s.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Exchange connections">
          <table className="w-full text-sm">
            <tbody>
              {o.exchanges.map((e) => (
                <tr
                  key={`${e.exchange}-${e.status}`}
                  className="border-b border-rule/60 last:border-0"
                >
                  <td className="py-1.5">{e.exchange}</td>
                  <td
                    className={e.status === "ACTIVE" ? "py-1.5 text-ink-muted" : "py-1.5 text-loss"}
                  >
                    {e.status.toLowerCase()}
                  </td>
                  <td className="figures py-1.5 text-right">{e.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
