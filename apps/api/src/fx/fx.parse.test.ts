import { describe, expect, it } from "vitest";
import { parseProviderRates } from "./fx.parse.js";

const table = (extra: Record<string, number> = {}) => {
  const rates: Record<string, number> = { USD: 1, EUR: 0.92, GBP: 0.79, PKR: 281.4, JPY: 149.8 };
  for (let i = 0; i < 60; i++)
    rates[`A${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`] =
      1 + i;
  return {
    result: "success",
    base_code: "USD",
    time_last_update_unix: 1_791_849_600,
    rates: { ...rates, ...extra },
  };
};

describe("parseProviderRates", () => {
  it("accepts a full USD table", () => {
    const r = parseProviderRates(table());
    expect(r.rates.PKR).toBe(281.4);
    expect(r.asOf.toISOString()).toBe("2026-10-13T00:00:00.000Z");
  });

  it("rejects errors, other bases and broken tables", () => {
    expect(() => parseProviderRates({ result: "error" })).toThrow();
    expect(() => parseProviderRates({ ...table(), base_code: "EUR" })).toThrow();
    expect(() => parseProviderRates(table({ USD: 2 }))).toThrow();
    expect(() => parseProviderRates(table({ PKR: -1 }))).toThrow();
    const { PKR: _drop, ...noPkr } = table().rates;
    expect(() => parseProviderRates({ ...table(), rates: noPkr })).toThrow(/PKR/);
  });
});
