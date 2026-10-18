import { addDays } from "@atc/analytics";

/** Monday of the week containing `day` (YYYY-MM-DD). */
export function weekStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}
