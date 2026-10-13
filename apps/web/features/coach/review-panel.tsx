import type { TradeReviewDto } from "@atc/shared";
import { Sparkles } from "lucide-react";
import { FlagList } from "./flag-list";
import { GradeBadge } from "./grade-badge";
import { ReviewActions } from "./review-actions";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-medium tracking-wide text-ink-faint uppercase">{title}</h3>
      <div className="mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}

/** Grade and behaviour flags (always, from rules) plus the AI-written review when available. */
export function ReviewPanel({
  positionId,
  review,
}: {
  positionId: string;
  review: TradeReviewDto;
}) {
  const r = review;
  return (
    <section
      aria-labelledby="review-heading"
      className="rounded-[var(--radius-surface)] surface p-5 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="review-heading" className="flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4 text-coach" aria-hidden="true" />
            Coach review
          </h2>
          <p className="mt-1 text-xs text-ink-faint">
            Grade scores your process (plan, risk, discipline) more than the result.
          </p>
        </div>
        <GradeBadge grade={r.grade} score={r.score} size="lg" />
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-ink-muted hover:text-ink">
          How this grade was scored ({r.score}/100)
        </summary>
        <ul className="figures mt-2 grid gap-1 text-xs text-ink-muted">
          <li>Starting score: 60</li>
          {r.gradeFactors.map((f) => (
            <li key={f.label} className="flex justify-between gap-4">
              <span>{f.label}</span>
              <span className={f.points > 0 ? "text-profit" : "text-loss"}>
                {f.points > 0 ? `+${f.points}` : `−${Math.abs(f.points)}`}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <div className="mt-5 grid gap-4">
        <Section title="Behaviour">
          <FlagList flags={r.flags} empty="No problem behaviours detected on this trade." />
        </Section>

        {r.status === "DONE" && r.summary ? (
          <>
            {r.stale && (
              <p className="rounded-[var(--radius-control)] bg-raised px-3 py-2 text-xs text-ink-muted">
                You changed this trade's review after the coach wrote this.
              </p>
            )}
            <Section title="Summary">{r.summary}</Section>
            <Section title="Entry">{r.entryAnalysis}</Section>
            <Section title="Exit">{r.exitAnalysis}</Section>
            <Section title="Risk">{r.riskAnalysis}</Section>
            {r.strategyAnalysis && <Section title="Strategy">{r.strategyAnalysis}</Section>}
            {r.positives.length > 0 && (
              <Section title="What you did well">
                <ul className="list-disc space-y-1 pl-5">
                  {r.positives.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Section>
            )}
            {r.mistakes.length > 0 && (
              <Section title="Mistakes">
                <ul className="list-disc space-y-1 pl-5">
                  {r.mistakes.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </Section>
            )}
            {r.nextTime && (
              <p className="rounded-[var(--radius-control)] border border-coach/40 bg-coach/10 px-3 py-2 text-sm">
                <span className="font-medium">Next time: </span>
                {r.nextTime}
              </p>
            )}
          </>
        ) : r.status === "LIMIT_REACHED" ? (
          <p className="text-sm text-ink-muted">
            You have used this month's AI reviews on your plan. Upgrade in Settings for more.
          </p>
        ) : r.status === "UNAVAILABLE" ? (
          <p className="text-sm text-ink-muted">AI reviews are not switched on for this app yet.</p>
        ) : r.status === "FAILED" ? (
          <p className="text-sm text-ink-muted">
            The last attempt to write this review failed. Try again.
          </p>
        ) : null}

        <ReviewActions positionId={positionId} status={r.status} stale={r.stale} />
      </div>
    </section>
  );
}
