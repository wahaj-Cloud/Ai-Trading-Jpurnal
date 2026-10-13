import { z } from "zod";

/** Economic calendar: market-moving releases (CPI, rate decisions, speeches) by currency. */

export const IMPACTS = ["HIGH", "MEDIUM", "LOW", "NONE"] as const;
export type Impact = (typeof IMPACTS)[number];

/** Currencies the calendar covers, most traded first. */
export const CALENDAR_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "AUD",
  "CAD",
  "CHF",
  "NZD",
  "CNY",
] as const;

export interface EconomicEventDto {
  id: string;
  title: string;
  /** Currency affected, e.g. "USD"; "ALL" for global events. */
  currency: string;
  impact: Impact;
  /** Release time (ISO, UTC). */
  startsAt: string;
  /** No exact time published (shown as "Tentative" or "All day"). */
  tentative: boolean;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
}

export interface EconomicCalendarDto {
  events: EconomicEventDto[];
  /** When the source was last read (ISO), null if never. */
  fetchedAt: string | null;
  source: { name: string; url: string };
}

/** Longest window one request may ask for. */
export const CALENDAR_MAX_DAYS = 62;

const csv = <T extends string>(allowed: readonly T[]) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : [],
    )
    .pipe(z.array(z.enum(allowed as unknown as [T, ...T[]])).max(allowed.length));

/** GET /v1/economic-calendar query: a time window plus optional impact and currency filters. */
export const economicCalendarQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    impact: csv(IMPACTS),
    currency: csv([...CALENDAR_CURRENCIES, "ALL"] as const),
  })
  .strict()
  .refine((q) => new Date(q.to) > new Date(q.from), { message: "to must be after from" })
  .refine(
    (q) => new Date(q.to).getTime() - new Date(q.from).getTime() <= CALENDAR_MAX_DAYS * 86_400_000,
    { message: `Ask for at most ${CALENDAR_MAX_DAYS} days at a time` },
  );
export type EconomicCalendarQuery = z.infer<typeof economicCalendarQuerySchema>;
