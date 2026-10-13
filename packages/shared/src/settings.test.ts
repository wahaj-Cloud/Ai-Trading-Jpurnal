import { describe, expect, it } from "vitest";
import { listCurrencies, listTimezones, updateProfileSchema } from "./settings.js";

describe("updateProfileSchema", () => {
  it("accepts a valid IANA timezone", () => {
    expect(updateProfileSchema.safeParse({ timezone: "Asia/Karachi" }).success).toBe(true);
  });
  it("rejects an unknown timezone", () => {
    expect(updateProfileSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
  });
  it("rejects unknown fields (mass-assignment protection)", () => {
    expect(updateProfileSchema.safeParse({ role: "ADMIN" }).success).toBe(false);
  });
  it("rejects an empty update", () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
  });
  it("lists UTC first", () => {
    expect(listTimezones()[0]).toBe("UTC");
  });
  it("accepts ISO display currencies in any case and rejects made-up ones", () => {
    const pkr = updateProfileSchema.safeParse({ displayCurrency: "pkr" });
    expect(pkr.success && pkr.data.displayCurrency).toBe("PKR");
    expect(updateProfileSchema.safeParse({ displayCurrency: "EUR" }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ displayCurrency: "ZZZ" }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ displayCurrency: "XAU" }).success).toBe(false);
  });
  it("lists popular currencies first, each once", () => {
    const list = listCurrencies();
    expect(list.slice(0, 2)).toEqual(["USD", "PKR"]);
    expect(new Set(list).size).toBe(list.length);
  });
});

import { connectExchangeSchema } from "./exchanges.js";

describe("connectExchangeSchema", () => {
  const valid = {
    exchange: "BINANCE",
    label: "Main",
    apiKey: "A".repeat(64),
    apiSecret: "b".repeat(64),
  };
  it("accepts a well-formed request and trims pasted whitespace", () => {
    const r = connectExchangeSchema.safeParse({ ...valid, apiKey: `  ${"A".repeat(64)}\n` });
    expect(r.success && r.data.apiKey).toBe("A".repeat(64));
  });
  it("accepts every catalog exchange", () => {
    for (const exchange of ["BINANCE", "MEXC", "BINGX"]) {
      expect(connectExchangeSchema.safeParse({ ...valid, exchange }).success).toBe(true);
    }
  });
  it("rejects unknown exchanges", () => {
    expect(connectExchangeSchema.safeParse({ ...valid, exchange: "FTX" }).success).toBe(false);
  });
  it("requires a passphrase for KuCoin and keeps it untrimmed", () => {
    expect(connectExchangeSchema.safeParse({ ...valid, exchange: "KUCOIN" }).success).toBe(false);
    const r = connectExchangeSchema.safeParse({
      ...valid,
      exchange: "KUCOIN",
      passphrase: "Pass-123!",
    });
    expect(r.success && r.data.passphrase).toBe("Pass-123!");
  });
  it("rejects a passphrase for exchanges that do not use one", () => {
    expect(connectExchangeSchema.safeParse({ ...valid, passphrase: "abc12345" }).success).toBe(
      false,
    );
  });
  it("rejects keys with inner whitespace", () => {
    expect(
      connectExchangeSchema.safeParse({ ...valid, apiSecret: "abc def ghi jkl mno" }).success,
    ).toBe(false);
  });
});
