import { BEHAVIOURS } from "@atc/shared";
import Link from "next/link";
import { Panel } from "@/features/analytics/metric";
import { GradeBadge } from "@/features/coach/grade-badge";
import { getNotes, getReviews } from "@/features/coach/load";
import { NoteCard } from "@/features/coach/note-card";
import { formatPnl, pnlTone } from "@/features/trades/format";
import { cn } from "@/lib/cn";
import { getMe } from "@/lib/me";

export const metadata = { title: "Journal" };

/** Journal history: coaching notes day by day, and every reviewed trade with its grade. */
export default async function JournalPage() {
  const [notes, reviews, me] = await Promise.all([getNotes(30), getReviews(40), getMe()]);
  const when = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: me.timezone,
  });

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Journal</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your coaching notes and reviewed trades. Open any trade from{" "}
          <Link href="/trades" className="text-ink underline underline-offset-4">
            Trades
          </Link>{" "}
          to review it.
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel title="Coaching notes">
          {notes.length ? (
            <div className="grid gap-8">
              {notes.map((n) => (
                <NoteCard key={n.id} note={n} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              Your coach writes a note after each day with closed trades, and a weekly one every
              Monday.
            </p>
          )}
        </Panel>
        <Panel title="Reviewed trades">
          {reviews.length ? (
            <ul className="grid gap-2">
              {reviews.map((r) => (
                <li key={r.positionId}>
                  <Link
                    href={`/trades/${r.positionId}`}
                    className="grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-[var(--radius-control)] border border-rule px-3 py-2.5 hover:border-ink-faint"
                  >
                    <GradeBadge grade={r.grade} size="md" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {r.symbol} {r.direction === "LONG" ? "long" : "short"}
                      </span>
                      <span className="block text-xs text-ink-muted">
                        {when.format(new Date(r.closedAt))}
                      </span>
                      {r.summary && (
                        <span className="mt-1 line-clamp-2 block text-xs text-ink-muted">
                          {r.summary}
                        </span>
                      )}
                      {r.flags.length > 0 && (
                        <span className="mt-1 block text-xs text-coach">
                          {r.flags.map((f) => BEHAVIOURS[f].label).join(" · ")}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "figures text-sm",
                        pnlTone(r.netPnl) === "loss"
                          ? "text-loss"
                          : pnlTone(r.netPnl) === "profit"
                            ? "text-profit"
                            : "text-ink-muted",
                      )}
                    >
                      {formatPnl(r.netPnl, r.settleAsset)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">Reviewed trades appear here with their grades.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
