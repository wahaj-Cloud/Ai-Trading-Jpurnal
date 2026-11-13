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

// ─── App preferences ───

/** Where the app opens after signing in. */
export const START_PAGES = {
  dashboard: { label: "Dashboard", href: "/dashboard" },
  journal: { label: "Journal", href: "/journal" },
  coach: { label: "AI Coach", href: "/coach" },
  desk: { label: "Market desk", href: "/desk" },
  orderflow: { label: "Order Flow", href: "/orderflow" },
  live: { label: "Live chart", href: "/live" },
  cockpit: { label: "Scalp Cockpit", href: "/cockpit" },
} as const;
export type StartPage = keyof typeof START_PAGES;
const START_PAGE_KEYS = Object.keys(START_PAGES) as [StartPage, ...StartPage[]];

/** Order Flow timeframes a trader can open by default (same list as the page). */
const OF_WINDOWS = ["5m", "15m", "30m", "1h", "4h", "24h"] as const;

/**
 * Preferences for how the app behaves (stored as one JSON document; every field optional so
 * older saves stay valid).
 */
export const appPrefsSchema = z
  .object({
    startPage: z.enum(START_PAGE_KEYS).default("dashboard"),
    /** Order Flow opens on this timeframe. */
    orderflowWindow: z.enum(OF_WINDOWS).default("1h"),
    /** Turn off animations and moving effects. */
    reduceMotion: z.boolean().default(false),
    /** Pre-fills calculators, the trade grader and paper bots. US$. */
    accountSizeUsd: z.number().positive().max(1_000_000_000).nullable().default(null),
    /** Planned risk per trade, % of the account. */
    riskPct: z.number().min(0.01).max(10).nullable().default(null),
  })
  .strict();
export type AppPrefs = z.output<typeof appPrefsSchema>;
export const DEFAULT_APP_PREFS: AppPrefs = appPrefsSchema.parse({});

/** Reads stored preferences, dropping anything no longer valid instead of failing. */
export function readAppPrefs(stored: unknown): AppPrefs {
  const whole = appPrefsSchema.safeParse(stored ?? {});
  if (whole.success) return whole.data;
  const out: Record<string, unknown> = {};
  const obj = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  for (const [k, field] of Object.entries(appPrefsSchema.shape)) {
    const one = (field as z.ZodType).safeParse(obj[k]);
    if (one.success) out[k] = one.data;
  }
  return appPrefsSchema.parse(out);
}

export const appPrefsPatchSchema = z
  .object({
    startPage: z.enum(START_PAGE_KEYS),
    orderflowWindow: z.enum(OF_WINDOWS),
    reduceMotion: z.boolean(),
    accountSizeUsd: z.number().positive().max(1_000_000_000).nullable(),
    riskPct: z.number().min(0.01).max(10).nullable(),
  })
  .partial()
  .strict();
export type AppPrefsPatch = z.infer<typeof appPrefsPatchSchema>;

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    timezone: timezoneSchema.optional(),
    baseCurrency: z.enum(BASE_CURRENCIES).optional(),
    displayCurrency: displayCurrencySchema.optional(),
    dashboardLayout: dashboardLayoutSchema.optional(),
    pnlColorScheme: z.enum(PNL_COLOR_SCHEMES).optional(),
    appPrefs: appPrefsPatchSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export function listTimezones(): string[] {
  return ["UTC", ...[...SUPPORTED_TIMEZONES].filter((tz) => tz !== "UTC")];
}
