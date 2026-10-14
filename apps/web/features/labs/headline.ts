import type { WhatIfResultDto } from "@atc/shared";
import { formatMoney } from "@/features/trades/format";

/** "Stopping after 2 losses in a row would have added $1,240 and cut your largest drawdown …" */
export function whatIfHeadline(r: WhatIfResultDto, currency: string): string {
  const diff = Number(r.difference.netPnl);
  if (r.removed === 0 && r.scaled === 0)
    return "None of your trades in this period break these rules.";
  const money = formatMoney(String(Math.abs(diff)), currency);
  const effect =
    diff > 0
      ? `would have added ${money}`
      : diff < 0
        ? `would have cost you ${money}`
        : "would have made no difference to your result";
  const ddBefore = formatMoney(r.actual.maxDrawdown, currency);
  const ddAfter = formatMoney(r.scenario.maxDrawdown, currency);
  const before = Number(r.actual.maxDrawdown);
  const after = Number(r.scenario.maxDrawdown);
  const dd =
    after < before
      ? ` and cut your largest drawdown from ${ddBefore} to ${ddAfter}`
      : after > before
        ? ` but deepened your largest drawdown from ${ddBefore} to ${ddAfter}`
        : "";
  return `${r.label} ${effect}${dd}.`;
}
