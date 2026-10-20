/**
 * "Grade my trade": scores a planned futures trade before it is placed, from fixed rules (no AI,
 * so the public tool costs nothing to run). Five checks worth 100 points: risk per trade, reward
 * vs risk after fees, leverage, distance between the stop and liquidation, and fee drag.
 */
export interface TradePlan {
  side: "LONG" | "SHORT";
  balance: number;
  entry: number;
  stop: number;
  target: number;
  /** Position size in quote currency (order value), e.g. 5000 USDT. */
  positionUsd: number;
  leverage: number;
  /** Fee per side as a percentage of order value (taker ≈ 0.05%). */
  feePct: number;
}

export type CheckStatus = "good" | "ok" | "bad";

export interface PlanCheck {
  id: "risk" | "reward" | "leverage" | "liquidation" | "fees";
  label: string;
  points: number;
  max: number;
  status: CheckStatus;
  detail: string;
}

export interface PlanGrade {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  riskUsd: number;
  riskPct: number;
  rewardUsd: number;
  /** Net reward ÷ net risk, fees included. */
  rr: number;
  breakevenWinRate: number;
  marginUsd: number;
  effectiveLeverage: number;
  liquidationPrice: number;
  feesUsd: number;
  checks: PlanCheck[];
}

/** Maintenance margin assumed for the liquidation estimate (typical for majors). */
const MAINT = 0.005;

const finite = (...n: number[]) => n.every((x) => Number.isFinite(x));
/** A share that rounds to zero but is not zero reads "under 1%" rather than a misleading "0%". */
const pct = (n: number, d = 1) =>
  n > 0 && Number(n.toFixed(d)) === 0 ? `under ${(10 ** -d).toFixed(d)}%` : `${n.toFixed(d)}%`;
/** Prices with sensible precision: 59,100.5 · 1.2345 · 0.00012345. */
export const fmtPrice = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 2 : n >= 1 ? 4 : 8 });

export function gradeTradePlan(p: TradePlan): PlanGrade | { error: string } {
  if (!finite(p.balance, p.entry, p.stop, p.target, p.positionUsd, p.leverage, p.feePct))
    return { error: "Fill in every field to see your grade." };
  if (p.balance <= 0 || p.entry <= 0 || p.stop <= 0 || p.target <= 0 || p.positionUsd <= 0)
    return { error: "Prices, balance and position size must be above zero." };
  if (p.leverage < 1 || p.leverage > 200) return { error: "Leverage must be between 1× and 200×." };
  if (p.feePct < 0 || p.feePct > 1) return { error: "Fee must be between 0% and 1% per side." };
  const long = p.side === "LONG";
  if (long ? p.stop >= p.entry : p.stop <= p.entry)
    return {
      error: long
        ? "For a long, the stop loss must be below the entry."
        : "For a short, the stop loss must be above the entry.",
    };
  if (long ? p.target <= p.entry : p.target >= p.entry)
    return {
      error: long
        ? "For a long, the target must be above the entry."
        : "For a short, the target must be below the entry.",
    };

  const qty = p.positionUsd / p.entry;
  const fee = p.feePct / 100;
  const feesUsd = p.positionUsd * fee * 2;
  const riskUsd = Math.abs(p.entry - p.stop) * qty + feesUsd;
  const rewardUsd = Math.abs(p.target - p.entry) * qty - feesUsd;
  const riskPct = (riskUsd / p.balance) * 100;
  const rr = rewardUsd > 0 ? rewardUsd / riskUsd : 0;
  const breakevenWinRate = rewardUsd > 0 ? (riskUsd / (riskUsd + rewardUsd)) * 100 : 100;
  const marginUsd = p.positionUsd / p.leverage;
  const effectiveLeverage = p.positionUsd / p.balance;
  const liquidationPrice = long
    ? p.entry * (1 - 1 / p.leverage + MAINT)
    : p.entry * (1 + 1 / p.leverage - MAINT);
  const stopBeforeLiq = long ? p.stop > liquidationPrice : p.stop < liquidationPrice;
  // How much of the way from entry to liquidation the stop sits (lower = safer).
  const stopShare = Math.abs(p.entry - p.stop) / Math.abs(p.entry - liquidationPrice);

  const checks: PlanCheck[] = [];

  // 1. Risk per trade (30)
  {
    const [points, status, detail]: [number, CheckStatus, string] =
      riskPct <= 1
        ? [
            30,
            "good",
            `You risk ${pct(riskPct, 2)} of your account. Professional range (1% or less).`,
          ]
        : riskPct <= 2
          ? [
              22,
              "ok",
              `You risk ${pct(riskPct, 2)}. Acceptable, but 1% lets you survive long losing streaks.`,
            ]
          : riskPct <= 3
            ? [
                12,
                "bad",
                `You risk ${pct(riskPct, 2)}. Ten losses in a row would cost about a quarter of your account. Reduce the position size.`,
              ]
            : riskPct <= 5
              ? [
                  5,
                  "bad",
                  `You risk ${pct(riskPct, 2)} on one trade. A short losing streak could do serious damage. Cut the size.`,
                ]
              : [
                  0,
                  "bad",
                  `You risk ${pct(riskPct, 1)} on one trade. That is gambling-level risk. Cut the size sharply.`,
                ];
    checks.push({ id: "risk", label: "Risk per trade", points, max: 30, status, detail });
  }

  // 2. Reward vs risk after fees (30)
  {
    const be = pct(breakevenWinRate, 0);
    const [points, status, detail]: [number, CheckStatus, string] =
      rr >= 3
        ? [
            30,
            "good",
            `1 : ${rr.toFixed(2)} after fees. You only need to win ${be} of trades like this to break even.`,
          ]
        : rr >= 2
          ? [25, "good", `1 : ${rr.toFixed(2)} after fees. Break-even win rate ${be}.`]
          : rr >= 1.5
            ? [
                18,
                "ok",
                `1 : ${rr.toFixed(2)} after fees. You need to win ${be} to break even; aim for 1 : 2 or better.`,
              ]
            : rr >= 1
              ? [
                  8,
                  "bad",
                  `1 : ${rr.toFixed(2)} after fees. You must win ${be} just to break even. Move the target or tighten the stop.`,
                ]
              : [
                  0,
                  "bad",
                  `1 : ${rr.toFixed(2)} after fees. You risk more than you can make. Rethink the target.`,
                ];
    checks.push({ id: "reward", label: "Reward vs risk", points, max: 30, status, detail });
  }

  // 3. Leverage on the whole account (15)
  {
    const lev = `${effectiveLeverage.toFixed(1)}×`;
    const [points, status, detail]: [number, CheckStatus, string] =
      marginUsd > p.balance
        ? [
            0,
            "bad",
            `This needs ${marginUsd.toFixed(2)} margin but the account has ${p.balance.toFixed(2)}. The order would be rejected.`,
          ]
        : effectiveLeverage <= 5
          ? [15, "good", `Position is ${lev} your account. Comfortable.`]
          : effectiveLeverage <= 10
            ? [11, "ok", `Position is ${lev} your account. Fine if the stop is respected.`]
            : effectiveLeverage <= 20
              ? [6, "bad", `Position is ${lev} your account. Small moves swing your balance a lot.`]
              : [0, "bad", `Position is ${lev} your account. One spike can wipe you out.`];
    checks.push({ id: "leverage", label: "Leverage", points, max: 15, status, detail });
  }

  // 4. Stop safely before liquidation (15)
  {
    const liq = fmtPrice(liquidationPrice);
    const [points, status, detail]: [number, CheckStatus, string] = !stopBeforeLiq
      ? [
          0,
          "bad",
          `Liquidation is around ${liq}, before your stop. You would be liquidated first. Lower the leverage.`,
        ]
      : stopShare <= 0.5
        ? [15, "good", `Your stop is well before the estimated liquidation (~${liq}).`]
        : stopShare <= 0.8
          ? [
              9,
              "ok",
              `Your stop is fairly close to the estimated liquidation (~${liq}). Slippage could matter.`,
            ]
          : [
              3,
              "bad",
              `Your stop is very close to liquidation (~${liq}). A wick could liquidate you. Lower the leverage.`,
            ];
    checks.push({
      id: "liquidation",
      label: "Liquidation safety",
      points,
      max: 15,
      status,
      detail,
    });
  }

  // 5. Fees eating the trade (10)
  {
    const share = rewardUsd + feesUsd > 0 ? (feesUsd / (rewardUsd + feesUsd)) * 100 : 100;
    const [points, status, detail]: [number, CheckStatus, string] =
      share <= 10
        ? [10, "good", `Fees take ${pct(share, 0)} of the profit if the target hits.`]
        : share <= 20
          ? [6, "ok", `Fees take ${pct(share, 0)} of the profit. Limit (maker) orders would help.`]
          : share <= 35
            ? [
                3,
                "bad",
                `Fees take ${pct(share, 0)} of the profit. The target is too close for the size.`,
              ]
            : [
                0,
                "bad",
                `Fees take ${pct(share, 0)} of the profit. This trade mostly pays the exchange.`,
              ];
    checks.push({ id: "fees", label: "Fees", points, max: 10, status, detail });
  }

  const score = checks.reduce((s, c) => s + c.points, 0);
  // Plans that can blow up the account are capped whatever else they get right: liquidation
  // before the stop or more than 3% at risk → at best D; more than 5% at risk → F.
  const cap = riskPct > 5 ? 39 : !stopBeforeLiq || riskPct > 3 ? 54 : 100;
  const capped = Math.min(score, cap);
  const grade =
    capped >= 85 ? "A" : capped >= 70 ? "B" : capped >= 55 ? "C" : capped >= 40 ? "D" : "F";
  return {
    score: capped,
    grade,
    riskUsd,
    riskPct,
    rewardUsd,
    rr,
    breakevenWinRate,
    marginUsd,
    effectiveLeverage,
    liquidationPrice,
    feesUsd,
    checks,
  };
}
