import type { AdminUserDetailDto } from "@atc/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FoundingMemberForm, PlanForm, SuspendForm } from "@/features/admin/forms";
import { Panel } from "@/features/analytics/metric";
import { ApiError, apiFetch } from "@/lib/api";

export const metadata = { title: "Admin · User" };

export default async function AdminUser({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const u = await apiFetch<AdminUserDetailDto>(`/v1/admin/users/${id}`).catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  });
  return (
    <>
      <div>
        <Link href="/admin/users" className="text-sm text-ink-muted hover:text-ink">
          Users
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{u.email}</h1>
        <p className="text-sm text-ink-muted">
          {u.name ?? "No name"} · {u.role.toLowerCase()} · joined {u.createdAt.slice(0, 10)} ·{" "}
          {u.timezone} · {u.trades} trades
          {u.suspended ? " · SUSPENDED" : ""}
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Plan">
          <p className="mb-4 text-sm text-ink-muted">
            {u.plan} ({u.status.toLowerCase()}){u.manualPlan ? ", granted manually" : ""}
            {u.paddleSubscriptionId ? `, billed online (${u.paddleSubscriptionId})` : ""}
            {u.currentPeriodEnd ? `, period ends ${u.currentPeriodEnd.slice(0, 10)}` : ""}.
          </p>
          <PlanForm userId={u.id} current={u.plan} />
        </Panel>
        <Panel title="Account access">
          <p className="mb-4 text-sm text-ink-muted">
            Suspending blocks sign-in to the app and stops nothing else; syncing continues until
            keys are removed.
          </p>
          <SuspendForm userId={u.id} suspended={u.suspended} />
        </Panel>
        <Panel title="Founding member">
          <FoundingMemberForm userId={u.id} founding={u.foundingMember} />
        </Panel>
      </div>
      <Panel title="Exchange connections">
        {u.accounts.length ? (
          <table className="w-full text-sm">
            <tbody>
              {u.accounts.map((a) => (
                <tr key={a.id} className="border-b border-rule/60 align-top last:border-0">
                  <td className="py-2">
                    {a.exchange} · {a.label}
                  </td>
                  <td className={a.status === "ACTIVE" ? "py-2 text-ink-muted" : "py-2 text-loss"}>
                    {a.status.toLowerCase()}
                  </td>
                  <td className="py-2 text-ink-muted">
                    {a.lastSyncedAt
                      ? `synced ${a.lastSyncedAt.slice(0, 16).replace("T", " ")}`
                      : "never synced"}
                  </td>
                  <td className="py-2 text-xs text-ink-muted">
                    {a.lastError ?? (a.syncFailures ? `${a.syncFailures} failures` : "")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-ink-muted">No exchanges connected.</p>
        )}
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Usage">
          <ul className="grid gap-1 text-sm">
            {u.usage.map((x) => (
              <li key={`${x.metric}-${x.period}`} className="flex justify-between">
                <span className="text-ink-muted">
                  {x.metric} · {x.period}
                </span>
                <span className="figures">{x.count}</span>
              </li>
            ))}
            {u.usage.length === 0 && <li className="text-ink-muted">No metered usage yet.</li>}
          </ul>
        </Panel>
        <Panel title="Recent activity">
          <ul className="grid gap-1 text-sm">
            {u.recentAudit.map((a) => (
              <li key={a.id}>
                <span className="figures text-xs text-ink-faint">
                  {a.createdAt.slice(0, 16).replace("T", " ")}
                </span>{" "}
                {a.action}
                {a.actorEmail && a.actorEmail !== u.email ? (
                  <span className="text-ink-muted"> by {a.actorEmail}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
