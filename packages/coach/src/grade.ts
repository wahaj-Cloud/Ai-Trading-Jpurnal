import type { BehaviourFlagDto, Grade } from "@atc/shared";
import type { CoachTrade } from "./types.js";

export interface GradeResult {
  grade: Grade;
  score: number;
  factors: { label: string; points: number }[];
}

const BASE = 60;

/**
 * Process-first grade. A disciplined loss can outscore a lucky, reckless win: points come from
 * having a plan (stop), following it (behaviour flags, logged mistakes, self-rating) and only
 * partly from the outcome, measured in R when a stop is known.
 */
export function gradeTrade(t: CoachTrade, flags: readonly BehaviourFlagDto[]): GradeResult {
  const factors: { label: string; points: number }[] = [];
  const add = (label: string, points: number) => {
    if (points !== 0) factors.push({ label, points: Math.round(points) });
  };
  const pnl = Number(t.netPnl);

  if (t.rMultiple !== null) {
    add(
      `Result ${t.rMultiple >= 0 ? "+" : ""}${t.rMultiple.toFixed(1)}R`,
      Math.max(-15, Math.min(20, t.rMultiple * 8)),
    );
  } else {
    add(pnl > 0 ? "Profitable" : pnl < 0 ? "Loss" : "Break-even", pnl > 0 ? 8 : pnl < 0 ? -8 : 0);
  }

  if (t.journal) {
    if (t.journal.stopPrice) add("Planned stop", 10);
    // A logged "no stop" mistake is already penalised (as a mistake and an undisciplined entry).
    else if (!t.journal.mistakes.includes("NO_STOP")) add("No planned stop", -10);
    if (t.plannedRewardRisk !== null && t.plannedRewardRisk >= 2) add("Planned 2R+ reward", 5);
    if (t.journal.rating !== null)
      add(`Your rating ${t.journal.rating}/5`, (t.journal.rating - 3) * 5);
    const mistakes = t.journal.mistakes.length;
    if (mistakes)
      add(`${mistakes} logged mistake${mistakes === 1 ? "" : "s"}`, -6 * Math.min(mistakes, 4));
    if (t.journal.setup) add("Named setup", 3);
  } else {
    add("Not journaled yet", -5);
  }

  const behaviourPenalty = { HIGH: -12, MEDIUM: -7, LOW: -3 } as const;
  for (const f of flags)
    add(f.code.toLowerCase().replaceAll("_", " "), behaviourPenalty[f.severity]);

  const fees = Number(t.fees ?? 0);
  if (pnl > 0 && fees > 0 && fees > 0.3 * (pnl + fees)) add("Fees ate over 30% of the gain", -5);

  const score = Math.max(0, Math.min(100, BASE + factors.reduce((s, f) => s + f.points, 0)));
  return { grade: letter(score), score, factors };
}

export function letter(score: number): Grade {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 68) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}
