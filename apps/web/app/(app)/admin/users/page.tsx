import type { AdminUsersPage } from "@atc/shared";
import Link from "next/link";
import { Input } from "@/components/ui/field";
import { apiFetch } from "@/lib/api";

export const metadata = { title: "Admin · Users" };
const UUID = /^[0-9a-f-]{36}$/i;

export default async function AdminUsers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const { q, cursor } = await searchParams;
  const qs = new URLSearchParams({
    ...(q ? { q: q.slice(0, 100) } : {}),
    ...(cursor && UUID.test(cursor) ? { cursor } : {}),
  });
  const page = await apiFetch<AdminUsersPage>(`/v1/admin/users?${qs}`);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
      <form className="flex max-w-md gap-2" aria-label="Search users">
        <label htmlFor="q" className="sr-only">
          Search by email or name
        </label>
        <Input id="q" name="q" defaultValue={q ?? ""} placeholder="Search by email or name" />
      </form>
      <div className="overflow-x-auto rounded-[var(--radius-surface)] border border-rule bg-panel">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-muted">
            <tr className="border-b border-rule">
              {["User", "Plan", "Exchanges", "Joined", ""].map((h) => (
                <th key={h} scope="col" className="px-4 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.items.map((u) => (
              <tr key={u.id} className="border-b border-rule/60 last:border-0">
                <td className="px-4 py-2">
                  <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                    {u.email}
                  </Link>
                  <span className="block text-xs text-ink-muted">
                    {u.name ?? "—"}
                    {u.role === "ADMIN" ? " · admin" : ""}
                    {u.suspended ? " · suspended" : ""}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {u.plan}
                  <span className="block text-xs text-ink-muted">
                    {u.status.toLowerCase()}
                    {u.manualPlan ? " · manual" : ""}
                  </span>
                </td>
                <td className="figures px-4 py-2">{u.exchanges}</td>
                <td className="px-4 py-2 text-ink-muted">{u.createdAt.slice(0, 10)}</td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/users/${u.id}`} className="text-ink-muted hover:text-ink">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {page.nextCursor && (
        <Link
          href={`/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), cursor: page.nextCursor })}`}
          className="text-sm text-ink-muted hover:text-ink"
        >
          More users
        </Link>
      )}
    </>
  );
}
