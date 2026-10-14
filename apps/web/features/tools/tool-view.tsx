"use client";

import type { ComponentType } from "react";
import {
  DrawdownCalc,
  ExpectancyCalc,
  KellyCalc,
  MonteCarloCalc,
  PositionSizeCalc,
  ProfitCalc,
  RiskRewardCalc,
  RuinCalc,
  WinRateCalc,
} from "@/features/calculators/calculators";
import { TradeGrader } from "./trade-grader";

const VIEWS: Record<string, ComponentType> = {
  "trade-grader": TradeGrader,
  "position-size-calculator": PositionSizeCalc,
  "risk-reward-calculator": RiskRewardCalc,
  "profit-calculator": ProfitCalc,
  "expectancy-calculator": ExpectancyCalc,
  "break-even-win-rate-calculator": WinRateCalc,
  "kelly-criterion-calculator": KellyCalc,
  "drawdown-recovery-calculator": DrawdownCalc,
  "risk-of-ruin-calculator": RuinCalc,
  "monte-carlo-simulator": MonteCarloCalc,
};

/** The interactive part of a public tool page. */
export function ToolView({ slug }: { slug: string }) {
  const View = VIEWS[slug];
  if (!View) return null;
  return slug === "trade-grader" ? (
    <View />
  ) : (
    <div className="mx-auto w-full max-w-xl">
      <View />
    </div>
  );
}

export const TOOL_SLUGS = Object.keys(VIEWS);
