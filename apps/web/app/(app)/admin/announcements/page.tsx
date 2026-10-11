import type { AnnouncementDto } from "@atc/shared";
import { AnnouncementForm, EndAnnouncementButton } from "@/features/admin/forms";
import { Panel } from "@/features/analytics/metric";
import { apiFetch } from "@/lib/api";

export const metadata = { title: "Admin · Announcements" };

export default async function AdminAnnouncements() {
  const list = await apiFetch<AnnouncementDto[]>("/v1/admin/announcements");
  const now = Date.now();
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Announcements</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="New announcement">
          <AnnouncementForm />
        </Panel>
        <Panel title="All announcements">
          <ul className="grid gap-2">
            {list.map((a) => {
              const live =
                new Date(a.startsAt).getTime() <= now &&
                (!a.endsAt || new Date(a.endsAt).getTime() > now);
              return (
                <li
                  key={a.id}
                  className="rounded-[var(--radius-control)] border border-rule px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">
                      {a.title}{" "}
                      <span className="text-xs font-normal text-ink-muted">
                        ({live ? "showing" : "ended"}, {a.level.toLowerCase()})
                      </span>
                    </p>
                    {live && <EndAnnouncementButton id={a.id} />}
                  </div>
                  <p className="text-sm text-ink-muted">{a.body}</p>
                </li>
              );
            })}
            {list.length === 0 && <li className="text-sm text-ink-muted">None yet.</li>}
          </ul>
        </Panel>
      </div>
    </>
  );
}
