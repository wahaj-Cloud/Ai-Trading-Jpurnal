"use client";

import { createContext, type ReactNode, useContext } from "react";

/** The trader's account size and risk per trade (Settings → Trading defaults), when set. */
export interface TradingDefaults {
  accountSizeUsd: number | null;
  riskPct: number | null;
}

const Ctx = createContext<TradingDefaults>({ accountSizeUsd: null, riskPct: null });

export function TradingDefaultsProvider({
  value,
  children,
}: {
  value: TradingDefaults;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The saved defaults as strings for inputs, or the given examples when none are saved. */
export function useTradingDefaults(example: { balance: string; risk: string }) {
  const d = useContext(Ctx);
  return {
    balance: d.accountSizeUsd !== null ? String(d.accountSizeUsd) : example.balance,
    risk: d.riskPct !== null ? String(d.riskPct) : example.risk,
    saved: d.accountSizeUsd !== null || d.riskPct !== null,
  };
}
