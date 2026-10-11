import type { CoachNoteDto } from "@atc/shared";
import { formatPercent, formatPnl, pnlTone } from "@/features/trades/format";
import { cn } from "@/lib/cn";

const dayFmt = new Intl.DateTimeFormat("en", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export function noteTitle(n: Pick<CoachNoteDto, "kind" | "period">): string {
  const d = new Date(`${n.period}T00:00:00Z`);
  return n.kind === "DAILY" ? dayFmt.format(d) : `Week of ${dayFmt.format(d)}`;
}

export function NoteCard({ note, compact = false }: { note: CoachNoteDto; compact?: boolean }) {
  const tone = pnlTone(note.stats.netPnl);
  return (
    <article className="grid gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-ink-faint">{noteTitle(note)}</p>
        <p className="figures text-xs text-ink-muted">
          {note.stats.trades} trades ·{" "}
          <span
            className={cn(tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : "")}
          >
            {formatPnl(note.stats.netPnl)}
          </span>{" "}
          · {formatPercent(note.stats.winRate, 0)} won
        </p>
      </header>
      <p className="font-medium">{note.headline}</p>
      {!compact && note.wentWell.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-profit">What worked</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {note.wentWell.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {note.costMoney.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-loss">What cost you</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {(compact ? note.costMoney.slice(0, 2) : note.costMoney).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="rounded-[var(--radius-control)] border border-coach/40 bg-coach/10 px-3 py-2 text-sm">
        <span className="font-medium">Focus: </span>
        {note.focus}
      </p>
    </article>
  );
}
