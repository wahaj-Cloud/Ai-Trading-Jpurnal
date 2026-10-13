import { z } from "zod";

/** Shape of the open.er-api.com "latest" response (ExchangeRate-API open access). */
const providerSchema = z.object({
  result: z.literal("success"),
  base_code: z.literal("USD"),
  time_last_update_unix: z.number().int().positive(),
  rates: z.record(z.string().regex(/^[A-Z]{3}$/), z.number().positive().finite()),
});

export interface ParsedRates {
  asOf: Date;
  rates: Record<string, number>;
}

/**
 * Validates a provider response. Rejects anything that does not look like a full USD table
 * (USD must be exactly 1 and the table must cover the major currencies), so one bad response
 * can never replace good stored rates.
 */
export function parseProviderRates(json: unknown): ParsedRates {
  const data = providerSchema.parse(json);
  if (data.rates.USD !== 1) throw new Error("Rates are not based on USD");
  for (const c of ["EUR", "GBP", "PKR", "JPY"]) {
    if (!(c in data.rates)) throw new Error(`Rates table is missing ${c}`);
  }
  if (Object.keys(data.rates).length < 50) throw new Error("Rates table is incomplete");
  return { asOf: new Date(data.time_last_update_unix * 1000), rates: data.rates };
}
