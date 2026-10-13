"use server";

import { getAnalytics } from "@/features/analytics/load";

/** The trader's symbols, most traded first, for the top-bar search. Empty on any failure. */
export async function searchContextAction(): Promise<{ symbols: string[]; currentMonth: string }> {
  try {
    const report = await getAnalytics("all");
    const symbols = [...report.bySymbol]
      .sort((a, b) => b.trades - a.trades)
      .map((b) => b.key)
      .slice(0, 200);
    return {
      symbols,
      currentMonth: (report.range.to ?? new Date().toISOString()).slice(0, 7),
    };
  } catch {
    return { symbols: [], currentMonth: new Date().toISOString().slice(0, 7) };
  }
}
