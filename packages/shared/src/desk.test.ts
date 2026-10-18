import { describe, expect, it } from "vitest";
import { deskSymbolOf } from "./desk.js";

describe("deskSymbolOf", () => {
  it("matches every exchange's naming of the desk markets", () => {
    const cases: Record<string, string> = {
      BTCUSDT: "BTCUSDT",
      "BTC-USDT-SWAP": "BTCUSDT",
      BTC_USDT: "BTCUSDT",
      "BTC-USDT": "BTCUSDT",
      XBTUSDTM: "BTCUSDT",
      BTCUSD_PERP: "BTCUSDT",
      BTCUSDC: "BTCUSDT",
      BTCUSDm: "BTCUSDT",
      ETHUSD_250926: "ETHUSDT",
      "ETH-USD-SWAP": "ETHUSDT",
      SOLUSDT: "SOLUSDT",
      XAUUSDm: "XAUUSDT",
      XAUUSD: "XAUUSDT",
      XAUUSDT: "XAUUSDT",
      XAGUSDm: "XAGUSDT",
    };
    for (const [s, want] of Object.entries(cases)) expect(deskSymbolOf(s), s).toBe(want);
  });
  it("never confuses look-alike tickers or other quotes", () => {
    for (const s of [
      "SOLVUSDT",
      "ETHFIUSDT",
      "ETHWUSDT",
      "BTCDOMUSDT",
      "ETHBTC",
      "SOLAYERUSDT",
      "XAUTUSDT",
      "1000SOLUSDT",
      "DOGEUSDT",
    ])
      expect(deskSymbolOf(s), s).toBeNull();
  });
});
