import "server-only";
import type { FxRatesDto } from "@atc/shared";
import { cache } from "react";
import { type Display, USD_DISPLAY } from "@/features/currency/convert";
import { apiFetch } from "./api";
import { getMe } from "./me";

/**
 * The currency this request shows amounts in, with today's rate. Deduplicated per request. If the
 * rate is missing (provider down on first use), amounts fall back to USD and say so.
 */
export const getDisplay = cache(async (): Promise<Display> => {
  const me = await getMe();
  const code = me.displayCurrency ?? "USD";
  if (code === "USD") return USD_DISPLAY;
  const fx = await apiFetch<FxRatesDto>("/v1/fx").catch(() => null);
  const rate = fx?.rates[code];
  if (!fx || !rate) return { ...USD_DISPLAY, unavailable: code };
  return { code, rate, asOf: fx.asOf };
});
