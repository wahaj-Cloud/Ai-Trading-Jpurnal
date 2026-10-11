import {
  GOAL_METRICS,
  type GoalDto,
  type GoalMetric,
  type GoalPeriod,
  RISK_RULES,
  type RiskLimits,
  type RiskRuleStatusDto,
} from "@atc/shared";
import { dec, str } from "@atc/trade-engine";
import { addDays } from "./time.js";

const NEAR = 0.8;
const usd = (v: number) => `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;

/**
 * Compares today's figures with the trader's limits. NEAR at 80% of a limit, BREACHED at or past it;
 * a profit target reports HIT once reached.
 */
export function evaluateRiskLimits(
  limits: RiskLimits,
  today: { pnl: string; trades: number },
  currentDrawdown: string,
): RiskRuleStatusDto[] {
  const out: RiskRuleStatusDto[] = [];
  const pnl = Number(today.pnl);
  const push = (s: Omit<RiskRuleStatusDto, "label">) =>
    out.push({ ...s, label: RISK_RULES[s.rule] });

  if (limits.maxDailyLoss) {
    const limit = Number(limits.maxDailyLoss);
    const loss = Math.max(0, -pnl);
    const used = loss / limit;
    push({
      rule: "MAX_DAILY_LOSS",
      limit: limits.maxDailyLoss,
      value: str(dec(today.pnl)),
      used,
      state: used >= 1 ? "BREACHED" : used >= NEAR ? "NEAR" : "OK",
      message:
        used >= 1
          ? `Daily loss limit reached: ${usd(pnl)} against your ${usd(-limit)} limit. Stop trading for today.`
          : used >= NEAR
            ? `You are at ${usd(pnl)}, ${Math.round(used * 100)}% of your daily loss limit.`
            : pnl >= 0
              ? `No loss today (${pnl > 0 ? "+" : ""}${usd(pnl)}); the limit is ${usd(-limit)}.`
              : `Down ${usd(pnl)} today, ${Math.round(used * 100)}% of your ${usd(-limit)} limit.`,
    });
  }
  if (limits.maxTradesPerDay) {
    const used = today.trades / limits.maxTradesPerDay;
    push({
      rule: "MAX_TRADES_PER_DAY",
      limit: String(limits.maxTradesPerDay),
      value: String(today.trades),
      used,
      state: used > 1 ? "BREACHED" : used >= 1 || used >= NEAR ? "NEAR" : "OK",
      message:
        used > 1
          ? `${today.trades} trades today: over your limit of ${limits.maxTradesPerDay}.`
          : used >= 1
            ? `That was trade ${today.trades} of ${limits.maxTradesPerDay} for today: your limit is reached.`
            : `${today.trades} of ${limits.maxTradesPerDay} trades today.`,
    });
  }
  if (limits.maxDrawdown) {
    const limit = Number(limits.maxDrawdown);
    const dd = Number(currentDrawdown);
    const used = dd / limit;
    push({
      rule: "MAX_DRAWDOWN",
      limit: limits.maxDrawdown,
      value: currentDrawdown,
      used,
      state: used >= 1 ? "BREACHED" : used >= NEAR ? "NEAR" : "OK",
      message:
        used >= 1
          ? `You are ${usd(dd)} below your equity peak: past your ${usd(limit)} drawdown limit. Consider pausing and reviewing.`
          : `${usd(dd)} below your equity peak (${Math.round(used * 100)}% of your limit).`,
    });
  }
  if (limits.dailyProfitTarget) {
    const target = Number(limits.dailyProfitTarget);
    const used = Math.max(0, pnl) / target;
    push({
      rule: "DAILY_PROFIT_TARGET",
      limit: limits.dailyProfitTarget,
      value: str(dec(today.pnl)),
      used,
      state: used >= 1 ? "HIT" : "OK",
      message:
        used >= 1
          ? `Daily target reached (${usd(pnl)}). Protect it: consider stopping for today.`
          : `${usd(Math.max(0, pnl))} of your ${usd(target)} daily target.`,
    });
  }
  return out;
}

/** First and last day of the week (Monday start) or month containing `day`. */
export function goalPeriod(period: GoalPeriod, day: string): { start: string; end: string } {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  if (period === "WEEK") {
    const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    const start = addDays(day, -weekday);
    return { start, end: addDays(start, 6) };
  }
  const start = `${day.slice(0, 7)}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start, end: `${day.slice(0, 7)}-${String(last).padStart(2, "0")}` };
}

export interface GoalFigures {
  netPnl: string;
  winRate: number | null;
  profitFactor: number | null;
  trades: number;
  reviewed: number;
}

/**
 * Progress on one goal in its current period. `elapsed` (0-1) is how much of the period has passed,
 * used to judge whether a "higher is better" goal is on pace.
 */
export function evaluateGoal(
  goal: { id: string; period: GoalPeriod; metric: GoalMetric; target: string },
  figures: GoalFigures,
  period: { start: string; end: string },
  elapsed: number,
): GoalDto {
  const meta = GOAL_METRICS[goal.metric];
  const target = Number(goal.target);
  let value: number;
  switch (goal.metric) {
    case "NET_PNL":
      value = Number(figures.netPnl);
      break;
    case "WIN_RATE":
      value = (figures.winRate ?? 0) * 100;
      break;
    case "PROFIT_FACTOR":
      value = figures.profitFactor ?? (Number(figures.netPnl) > 0 ? target : 0);
      break;
    case "MAX_TRADES":
      value = figures.trades;
      break;
    case "REVIEW_RATE":
      value = figures.trades ? (figures.reviewed / figures.trades) * 100 : 0;
      break;
  }
  const periodName = goal.period === "WEEK" ? "this week" : "this month";
  const shown =
    meta.unit === "USD"
      ? usd(value)
      : meta.unit === "%"
        ? `${value.toFixed(0)}%`
        : value.toFixed(meta.unit === "" ? 2 : 0);
  const targetShown =
    meta.unit === "USD" ? usd(target) : meta.unit === "%" ? `${target}%` : String(target);

  if (meta.better === "LOWER") {
    const progress = target ? value / target : 1;
    const state = value > target ? "FAILED" : "ON_TRACK";
    return {
      id: goal.id,
      period: goal.period,
      metric: goal.metric,
      label: meta.label,
      target: goal.target,
      periodStart: period.start,
      periodEnd: period.end,
      value: String(value),
      progress,
      state: elapsed >= 1 && state === "ON_TRACK" ? "MET" : state,
      message:
        state === "FAILED"
          ? `${value} trades ${periodName}: over your limit of ${target}.`
          : `${value} of at most ${target} trades ${periodName}.`,
    };
  }
  const progress = target > 0 ? Math.max(0, value / target) : 0;
  let state: GoalDto["state"];
  if (goal.metric === "NET_PNL") {
    // Cumulative: met as soon as reached; otherwise judged against the time elapsed.
    state =
      progress >= 1
        ? "MET"
        : elapsed >= 1
          ? "FAILED"
          : progress >= elapsed * 0.9
            ? "ON_TRACK"
            : "BEHIND";
  } else {
    // Ratios can fall again, so they are only "met" when the period ends. Need a few trades to count.
    const above = progress >= 1 && figures.trades >= 3;
    state = elapsed >= 1 ? (above ? "MET" : "FAILED") : above ? "ON_TRACK" : "BEHIND";
  }
  return {
    id: goal.id,
    period: goal.period,
    metric: goal.metric,
    label: meta.label,
    target: goal.target,
    periodStart: period.start,
    periodEnd: period.end,
    value: String(Number(value.toFixed(2))),
    progress,
    state,
    message:
      state === "MET"
        ? `Goal met: ${shown} ${periodName} (target ${targetShown}).`
        : `${shown} of ${targetShown} ${periodName}${state === "BEHIND" ? ", behind pace" : ""}.`,
  };
}
