import type { RiskDto } from "@atc/shared";
import { dec, str } from "@atc/trade-engine";

export interface RiskInput {
  direction: "LONG" | "SHORT";
  entryPrice: string | null;
  quantity: string | null;
  netPnl: string | null;
  stopPrice: string | null;
  targetPrice: string | null;
  /** Inverse contracts are sized in USD; R is not computed for them yet. */
  inverse: boolean;
}

const NONE: RiskDto = { riskAmount: null, rMultiple: null, plannedRewardRisk: null };

/**
 * Risk measured from the trader's planned stop: R = result / money at risk. A stop on the wrong
 * side of the entry (e.g. a long's stop above entry, i.e. a locked-in profit) carries no initial
 * risk, so R is undefined rather than misleading.
 */
export function tradeRisk(input: RiskInput): RiskDto {
  const { direction, entryPrice, quantity, netPnl, stopPrice, targetPrice, inverse } = input;
  if (!entryPrice || !stopPrice || inverse) return NONE;
  const entry = dec(entryPrice);
  const stop = dec(stopPrice);
  const perUnit = direction === "LONG" ? entry.minus(stop) : stop.minus(entry);
  if (perUnit.lte(0)) return NONE;

  let plannedRewardRisk: number | null = null;
  if (targetPrice) {
    const target = dec(targetPrice);
    const reward = direction === "LONG" ? target.minus(entry) : entry.minus(target);
    if (reward.gt(0)) plannedRewardRisk = reward.div(perUnit).toDecimalPlaces(2).toNumber();
  }
  if (!quantity || dec(quantity).lte(0)) return { ...NONE, plannedRewardRisk };

  const risk = perUnit.times(quantity);
  return {
    riskAmount: str(risk.toDecimalPlaces(8)),
    rMultiple: netPnl === null ? null : dec(netPnl).div(risk).toDecimalPlaces(2).toNumber(),
    plannedRewardRisk,
  };
}
