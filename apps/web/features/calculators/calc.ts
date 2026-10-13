/**
 * Trading calculators. Pure functions: every input is a plain number, every output is a number or
 * null when the inputs make no sense (zero stop distance, win rate outside 0–100, …).
 */

const finite = (...xs: number[]) => xs.every((x) => Number.isFinite(x));

export interface PositionSize {
  /** Money at risk if the stop is hit. */
  riskAmount: number;
  /** Quantity of the coin/contract to buy or sell. */
  quantity: number;
  /** Position value at entry. */
  notional: number;
  /** Margin needed at the given leverage. */
  margin: number;
}

/** How big a position is so that hitting the stop loses exactly `riskPct` of the balance. */
export function positionSize(
  balance: number,
  riskPct: number,
  entry: number,
  stop: number,
  leverage = 1,
): PositionSize | null {
  if (!finite(balance, riskPct, entry, stop, leverage)) return null;
  const distance = Math.abs(entry - stop);
  if (balance <= 0 || riskPct <= 0 || entry <= 0 || distance === 0 || leverage <= 0) return null;
  const riskAmount = (balance * riskPct) / 100;
  const quantity = riskAmount / distance;
  const notional = quantity * entry;
  return { riskAmount, quantity, notional, margin: notional / leverage };
}

export interface RiskReward {
  /** Reward divided by risk, e.g. 2.5 means 1:2.5. */
  ratio: number;
  /** Win rate needed to break even at this ratio (percent). */
  breakevenWinRate: number;
}

export function riskReward(entry: number, stop: number, target: number): RiskReward | null {
  if (!finite(entry, stop, target)) return null;
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  // Stop and target must sit on opposite sides of the entry.
  if (risk === 0 || reward === 0 || Math.sign(stop - entry) === Math.sign(target - entry))
    return null;
  const ratio = reward / risk;
  return { ratio, breakevenWinRate: requiredWinRate(ratio) as number };
}

/** Profit of a futures trade, after a round-trip fee in percent of notional per side. */
export function tradeProfit(
  side: "LONG" | "SHORT",
  entry: number,
  exit: number,
  quantity: number,
  feePct = 0,
): { gross: number; fees: number; net: number; returnPct: number } | null {
  if (!finite(entry, exit, quantity, feePct) || entry <= 0 || exit <= 0 || quantity <= 0)
    return null;
  const gross = (side === "LONG" ? exit - entry : entry - exit) * quantity;
  const fees = ((entry + exit) * quantity * feePct) / 100;
  const net = gross - fees;
  return { gross, fees, net, returnPct: (net / (entry * quantity)) * 100 };
}

/** Gain needed to get back to the peak after losing `drawdownPct`. */
export function recoveryNeeded(drawdownPct: number): number | null {
  if (!finite(drawdownPct) || drawdownPct < 0 || drawdownPct >= 100) return null;
  return (drawdownPct / (100 - drawdownPct)) * 100;
}

/** Average result per trade in money: winRate × avgWin − lossRate × avgLoss. */
export function expectancy(winRatePct: number, avgWin: number, avgLoss: number): number | null {
  if (!finite(winRatePct, avgWin, avgLoss) || winRatePct < 0 || winRatePct > 100) return null;
  if (avgWin < 0 || avgLoss < 0) return null;
  const p = winRatePct / 100;
  return p * avgWin - (1 - p) * avgLoss;
}

/** Win rate (percent) at which a strategy with this reward-to-risk ratio breaks even. */
export function requiredWinRate(rewardToRisk: number): number | null {
  if (!finite(rewardToRisk) || rewardToRisk <= 0) return null;
  return (1 / (1 + rewardToRisk)) * 100;
}

/**
 * Kelly fraction (percent of balance to risk per trade). Negative means the edge is negative and
 * nothing should be risked. Most traders use a quarter or half of this.
 */
export function kelly(winRatePct: number, rewardToRisk: number): number | null {
  if (
    !finite(winRatePct, rewardToRisk) ||
    winRatePct < 0 ||
    winRatePct > 100 ||
    rewardToRisk <= 0
  ) {
    return null;
  }
  const p = winRatePct / 100;
  return (p - (1 - p) / rewardToRisk) * 100;
}

/**
 * Probability (percent) of losing `ruinPct` of the account, risking a fixed `riskPct` of the
 * starting balance per trade. Classic gambler's-ruin approximation for a trade with payoff
 * `rewardToRisk`; returns 100 when the edge is zero or negative.
 */
export function riskOfRuin(
  winRatePct: number,
  rewardToRisk: number,
  riskPct: number,
  ruinPct = 50,
): number | null {
  if (!finite(winRatePct, rewardToRisk, riskPct, ruinPct)) return null;
  if (winRatePct < 0 || winRatePct > 100 || rewardToRisk <= 0 || riskPct <= 0 || ruinPct <= 0) {
    return null;
  }
  const p = winRatePct / 100;
  const edge = p * rewardToRisk - (1 - p);
  if (edge <= 0) return 100;
  // Variance of one trade in units of risk; drift per trade is `edge`.
  const variance = p * rewardToRisk ** 2 + (1 - p) - edge ** 2;
  const units = ruinPct / riskPct;
  return Math.min(100, Math.exp((-2 * edge * units) / variance) * 100);
}

/** Small deterministic PRNG so a Monte Carlo run is reproducible for a given seed. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MonteCarlo {
  /** Final balance percentiles across all runs. */
  p10: number;
  median: number;
  p90: number;
  /** Median of each run's worst peak-to-trough drop, percent. */
  medianMaxDrawdownPct: number;
  /** Share of runs that ended below the starting balance, percent. */
  lossChancePct: number;
}

/** Simulates `trades` trades `runs` times, risking `riskPct` of the current balance each time. */
export function monteCarlo(
  balance: number,
  winRatePct: number,
  rewardToRisk: number,
  riskPct: number,
  trades = 100,
  runs = 1000,
  seed = 42,
): MonteCarlo | null {
  if (!finite(balance, winRatePct, rewardToRisk, riskPct, trades, runs)) return null;
  if (balance <= 0 || winRatePct < 0 || winRatePct > 100 || rewardToRisk <= 0 || riskPct <= 0) {
    return null;
  }
  if (trades < 1 || runs < 1 || trades > 10_000 || runs > 20_000) return null;
  const rand = mulberry32(seed);
  const p = winRatePct / 100;
  const r = riskPct / 100;
  const finals: number[] = [];
  const drawdowns: number[] = [];
  for (let run = 0; run < runs; run++) {
    let b = balance;
    let peak = b;
    let worst = 0;
    for (let t = 0; t < trades; t++) {
      b += rand() < p ? b * r * rewardToRisk : -b * r;
      if (b > peak) peak = b;
      worst = Math.max(worst, (peak - b) / peak);
    }
    finals.push(b);
    drawdowns.push(worst * 100);
  }
  finals.sort((a, b) => a - b);
  drawdowns.sort((a, b) => a - b);
  const at = (xs: number[], q: number) =>
    xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] ?? 0;
  return {
    p10: at(finals, 0.1),
    median: at(finals, 0.5),
    p90: at(finals, 0.9),
    medianMaxDrawdownPct: at(drawdowns, 0.5),
    lossChancePct: (finals.filter((f) => f < balance).length / runs) * 100,
  };
}
