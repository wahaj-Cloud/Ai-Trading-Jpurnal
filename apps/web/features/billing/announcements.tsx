import type { AnnouncementDto } from "@atc/shared";
import { Info, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

/** Site-wide messages from the team (maintenance, new features). */
export async function Announcements() {
  const list = await apiFetch<AnnouncementDto[]>("/v1/announcements").catch(() => []);
  if (list.length === 0) return null;
  return (
    <div className="mx-auto mb-4 grid max-w-7xl gap-2">
      {list.map((a) => {
        const Icon = a.level === "WARNING" ? TriangleAlert : Info;
        return (
          <section
            key={a.id}
            role="status"
            className={cn(
              "flex gap-3 rounded-[var(--radius-surface)] border px-4 py-3 text-sm",
              a.level === "WARNING" ? "border-coach/50 bg-coach/10" : "border-rule bg-raised",
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-coach" aria-hidden="true" />
            <p>
              <span className="font-medium">{a.title}.</span>{" "}
              <span className="text-ink-muted">{a.body}</span>
            </p>
          </section>
        );
      })}
    </div>
  );
}
