import { evaluateFlags, type PermissionEvaluation } from "../permissions.js";

/** Policy for GET /sapi/v1/account/apiRestrictions. Labels match Binance's key settings page. */
export const BINANCE_POLICY = {
  readFlags: new Set(["enableReading", "enableFixReadOnly"]),
  requiredFlags: ["enableReading"],
  mustReport: ["enableReading", "enableWithdrawals"],
  ignoreFlags: new Set(["ipRestrict"]),
  labels: {
    enableReading: "Enable Reading",
    enableWithdrawals: "Enable Withdrawals",
    enableSpotAndMarginTrading: "Enable Spot & Margin Trading",
    enableFutures: "Enable Futures",
    enableMargin: "Enable Margin Loan, Repay & Transfer",
    enableInternalTransfer: "Permits Internal Transfer",
    permitsUniversalTransfer: "Permits Universal Transfer",
    enableVanillaOptions: "Enable European Options",
    enablePortfolioMarginTrading: "Enable Portfolio Margin Trading",
    enableFixApiTrade: "FIX API trading",
  },
} as const;

export function evaluateBinanceRestrictions(
  restrictions: Record<string, unknown>,
): PermissionEvaluation {
  return evaluateFlags(restrictions, BINANCE_POLICY);
}
