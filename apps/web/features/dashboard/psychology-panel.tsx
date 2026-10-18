import {
  BEHAVIOURS,
  DISCIPLINE_MIN_TRADES,
  disciplineLabel,
  type PsychologyReportDto,
} from "@atc/shared";
import { Brain } from "lucide-react";
import Link from "next/link";
import { formatPnl } from "@/features/trades/format";
import { cn } from "@/lib/cn";

const tone = (score: number) =>
  score >= 70 ? "text-profit" : score >= 50 ? "text-[#f5b84d]" : "text-loss";
const stroke = (score: number) => (score >= 70 ? "#3EE0A3" : score >= 50 ? "#f5b84d" : "#FF6B7A");

function ScoreRing({ score }: { score: number }) {
  const R = 42;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-hi/[0.08]"
        />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke={stroke(score)}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${(C * score) / 100} ${C}`}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className={cn("figures text-3xl font-semibold leading-none", tone(score))}>{score}</p>
          <p className="mt-1 text-[11px] text-ink-faint">of 100</p>
        </div>
      </div>
    </div>
  );
}

function Part({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  return (
    <li className="grid gap-1" title={hint}>
      <div className="flex justify-between text-xs">
        <span className="text-ink-muted">{label}</span>
        <span className="figures">{value === null ? "n/a" : `${value}%`}</span>
      </div>
      <div className="h-1.5 rounded-full bg-hi/[0.08]">
        {value !== null && (
          <div
            className="h-full rounded-full"
            style={{ width: `${value}%`, background: stroke(value) }}
          />
        )}
      </div>
    </li>
  );
}

function Trend({ trend }: { trend: PsychologyReportDto["trend"] }) {
  return (
    <div>
      <p className="mb-2 text-xs text-ink-faint">Discipline by week, last 8 weeks</p>
      <ol className="grid grid-cols-8 gap-1.5" aria-label="Discipline score by week">
        {trend.map((w, i) => (
          <li
            key={w.week}
            className="grid gap-1 text-center"
            title={`Week of ${w.week}: ${w.score === null ? `${w.trades} trades (not enough to score)` : `${w.score}/100 over ${w.trades} trades`}`}
          >
            <span className="flex h-14 flex-col justify-end">
              {w.score === null ? (
                <span className="h-1 rounded-sm bg-hi/[0.08]" />
              ) : (
                <span
                  className="rounded-sm"
                  style={{ height: `${Math.max(6, w.score)}%`, background: stroke(w.score) }}
                />
              )}
            </span>
            <span className="figures text-[11px] text-ink-muted">{w.score ?? "–"}</span>
            <span className="text-[10px] text-ink-faint">
              {i === trend.length - 1 ? "This wk" : `${trend.length - 1 - i}w ago`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Discipline score (0–100, three measured parts, weekly trend) and the psychological tax: what the
 * trades flagged with emotional habits cost in the last 30 days.
 */
export function PsychologyPanel({ report }: { report: PsychologyReportDto }) {
  const { score, parts, tax } = report;
  return (
    <section
      aria-labelledby="psychology-heading"
      className="min-w-0 rounded-[var(--radius-surface)] surface p-5 sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="psychology-heading" className="flex items-center gap-2 font-semibold">
          <Brain className="h-4 w-4 text-coach" aria-hidden="true" />
          Discipline and psychology <span className="font-normal text-ink-faint">· 30 days</span>
        </h2>
        <Link
          href="/coach"
          className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Work on it with your coach
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          {score !== null && parts ? (
            <div className="flex flex-wrap items-center gap-5">
              <ScoreRing score={score} />
              <div className="grid min-w-[12rem] flex-1 gap-3">
                <p className="text-sm">
                  <span className={cn("font-semibold", tone(score))}>{disciplineLabel(score)}</span>{" "}
                  <span className="text-ink-muted">discipline over {report.trades} trades</span>
                </p>
                <ul className="grid gap-2.5">
                  <Part
                    label="Clean trades (no habit flagged)"
                    value={parts.clean}
                    hint="Half of the score"
                  />
                  <Part
                    label="Steady position size"
                    value={parts.sizing}
                    hint="A quarter of the score: trades sized between half and twice your normal size"
                  />
                  <Part
                    label="Calm days (no revenge or overtrading)"
                    value={parts.calmDays}
                    hint="A quarter of the score"
                  />
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              Your discipline score appears after {DISCIPLINE_MIN_TRADES} closed trades in the last
              30 days ({report.trades} so far).
            </p>
          )}
          <Trend trend={report.trend} />
        </div>

        <div className="grid content-start gap-3 rounded-[var(--radius-control)] border border-rule p-4">
          <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">
            Psychological tax
          </p>
          {tax ? (
            <>
              <p className="figures text-3xl font-semibold text-loss">{formatPnl(tax.netPnl)}</p>
              <p className="text-sm text-ink-muted">
                Net result of {tax.trades} trade{tax.trades === 1 ? "" : "s"} taken with an
                emotional habit
                {tax.lossShare !== null && (
                  <>
                    {" "}
                    ·{" "}
                    <span className="text-ink">
                      {Math.round(tax.lossShare * 100)}% of all your losses
                    </span>
                  </>
                )}
                .
              </p>
              <ul className="grid gap-1.5 text-sm">
                {report.byHabit
                  .filter((h) => Number(h.netPnl) < 0)
                  .slice(0, 4)
                  .map((h) => (
                    <li key={h.code} className="flex justify-between gap-3">
                      <span>
                        {BEHAVIOURS[h.code].label}{" "}
                        <span className="text-xs text-ink-faint">· {h.trades}</span>
                      </span>
                      <span className="figures text-loss">{formatPnl(h.netPnl)}</span>
                    </li>
                  ))}
              </ul>
              <p className="text-xs text-ink-faint">
                A trade can carry more than one habit, so the habits overlap; the total counts each
                trade once.
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-muted">
              {report.byHabit.length
                ? "Trades flagged with emotional habits did not lose money overall in the last 30 days. Keep it that way."
                : "No emotional habits flagged in the last 30 days. Journal emotions and mistakes so the coach can spot more."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
