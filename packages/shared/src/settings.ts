import { z } from "zod";
import { dashboardLayoutSchema } from "./dashboard.js";

const SUPPORTED_TIMEZONES: ReadonlySet<string> = new Set(Intl.supportedValuesOf("timeZone"));

export const BASE_CURRENCIES = ["USDT", "USDC", "USD"] as const;
export const PNL_COLOR_SCHEMES = ["standard", "colorblind"] as const;

/** ISO 4217 codes the runtime knows; precious metals and fund codes (X..) are not money to show. */
const SUPPORTED_CURRENCIES: ReadonlySet<string> = new Set(
  Intl.supportedValuesOf("currency").filter((c) => !c.startsWith("X")),
);

/** Currency every amount is shown in. Amounts are stored in USD and converted for display. */
export const displayCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => c === "USD" || SUPPORTED_CURRENCIES.has(c), { message: "Unknown currency" });

/** Shown first in the currency picker; the rest follow alphabetically. */
export const POPULAR_CURRENCIES = [
  "USD",
  "PKR",
  "EUR",
  "GBP",
  "AED",
  "SAR",
  "INR",
  "CAD",
  "AUD",
  "TRY",
  "JPY",
  "CNY",
] as const;

export function listCurrencies(): string[] {
  const rest = [...SUPPORTED_CURRENCIES]
    .filter((c) => !(POPULAR_CURRENCIES as readonly string[]).includes(c))
    .sort();
  return [...POPULAR_CURRENCIES, ...rest];
}

export const timezoneSchema = z
  .string()
  .refine((tz) => tz === "UTC" || SUPPORTED_TIMEZONES.has(tz), { message: "Unknown timezone" });

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    timezone: timezoneSchema.optional(),
    baseCurrency: z.enum(BASE_CURRENCIES).optional(),
    displayCurrency: displayCurrencySchema.optional(),
    dashboardLayout: dashboardLayoutSchema.optional(),
    pnlColorScheme: z.enum(PNL_COLOR_SCHEMES).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export function listTimezones(): string[] {
  return ["UTC", ...[...SUPPORTED_TIMEZONES].filter((tz) => tz !== "UTC")];
}
