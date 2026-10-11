import type { BehaviourSummaryDto, CoachNoteDto } from "@atc/shared";
import { MessageSquareText } from "lucide-react";
import Link from "next/link";
import { Habits } from "@/features/coach/habits";
import { NoteCard } from "@/features/coach/note-card";

/** Latest coaching note plus the habits that cost the most money in the last 30 days. */
export function CoachPanel({
  note,
  habits,
}: {
  note: CoachNoteDto | null;
  habits: BehaviourSummaryDto | null;
}) {
  return (
    <section
      aria-labelledby="coach-heading"
      className="flex flex-col gap-5 rounded-[var(--radius-surface)] border border-rule bg-panel p-5 sm:p-6"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="coach-heading" className="flex items-center gap-2 font-semibold">
          <MessageSquareText className="h-4 w-4 text-coach" aria-hidden="true" />
          Your coach
        </h2>
        <Link
          href="/coach"
          className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Ask a question
        </Link>
      </div>
      {note ? (
        <NoteCard note={note} compact />
      ) : (
        <p className="text-sm text-ink-muted">
          After each trading day your coach sums up what worked, which habits cost you money, and
          one thing to focus on next. Your first note arrives after a day with closed trades.
        </p>
      )}
      {habits && (
        <div>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-ink-faint uppercase">
            Habits costing you money (30 days)
          </h3>
          <Habits summary={habits} limit={3} />
        </div>
      )}
    </section>
  );
}
