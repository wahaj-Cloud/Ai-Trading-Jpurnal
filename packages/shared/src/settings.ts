import { z } from "zod";

const SUPPORTED_TIMEZONES: ReadonlySet<string> = new Set(Intl.supportedValuesOf("timeZone"));

export const BASE_CURRENCIES = ["USDT", "USDC", "USD"] as const;
export const PNL_COLOR_SCHEMES = ["standard", "colorblind"] as const;

export const timezoneSchema = z
  .string()
  .refine((tz) => tz === "UTC" || SUPPORTED_TIMEZONES.has(tz), { message: "Unknown timezone" });

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    timezone: timezoneSchema.optional(),
    baseCurrency: z.enum(BASE_CURRENCIES).optional(),
    pnlColorScheme: z.enum(PNL_COLOR_SCHEMES).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export function listTimezones(): string[] {
  return ["UTC", ...[...SUPPORTED_TIMEZONES].filter((tz) => tz !== "UTC")];
}
