import "server-only";
import type { EconomicCalendarDto, Impact } from "@atc/shared";
import { apiFetch } from "@/lib/api";

export function getCalendar(opts: {
  from: Date;
  to: Date;
  impact?: readonly Impact[];
  currency?: readonly string[];
}): Promise<EconomicCalendarDto> {
  const q = new URLSearchParams({ from: opts.from.toISOString(), to: opts.to.toISOString() });
  if (opts.impact?.length) q.set("impact", opts.impact.join(","));
  if (opts.currency?.length) q.set("currency", opts.currency.join(","));
  return apiFetch<EconomicCalendarDto>(`/v1/economic-calendar?${q}`);
}
