import type { DayDto } from "@atc/shared";

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface MonthStats {
  trades: number;
  wins: number;
  /** Share of closed trades that won (0–1, like the API); null without trades. */
  winRate: number | null;
  net: number;
  tradingDays: number;
  greenDays: number;
  redDays: number;
  best: DayDto | null;
  worst: DayDto | null;
  /** Average result per trading day. */
  avgDay: number | null;
}

export function monthDays(days: readonly DayDto[], month: string): DayDto[] {
  return days.filter((d) => d.date.startsWith(`${month}-`));
}

export function monthStats(days: readonly DayDto[], month: string): MonthStats {
  const inMonth = monthDays(days, month);
  const trades = inMonth.reduce((n, d) => n + d.trades, 0);
  const wins = inMonth.reduce((n, d) => n + d.wins, 0);
  const net = inMonth.reduce((n, d) => n + Number(d.pnl), 0);
  let best: DayDto | null = null;
  let worst: DayDto | null = null;
  for (const d of inMonth) {
    if (Number(d.pnl) > 0 && (!best || Number(d.pnl) > Number(best.pnl))) best = d;
    if (Number(d.pnl) < 0 && (!worst || Number(d.pnl) < Number(worst.pnl))) worst = d;
  }
  return {
    trades,
    wins,
    winRate: trades ? wins / trades : null,
    net,
    tradingDays: inMonth.length,
    greenDays: inMonth.filter((d) => Number(d.pnl) > 0).length,
    redDays: inMonth.filter((d) => Number(d.pnl) < 0).length,
    best,
    worst,
    avgDay: inMonth.length ? net / inMonth.length : null,
  };
}

/** "2026-10" shifted by whole months. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const nameFmt = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
export const monthLabel = (month: string) => nameFmt.format(new Date(`${month}-01T00:00:00Z`));
