import { describe, expect, it } from "vitest";
import { fakeExchange } from "../test-utils.js";
import { fetchCmcAltcoinSeason, fetchCmcFearGreed, fetchCmcGlobal } from "./coinmarketcap.js";

const ok = (data: unknown) => ({ body: { status: { error_code: 0, error_message: null }, data } });

function cmc() {
  return fakeExchange((url) => {
    const path = url.pathname.replace(/^\/public-api/, "");
    if (path === "/v1/global-metrics/quotes/latest") {
      return ok({
        btc_dominance: 57.31,
        quote: {
          USD: {
            total_market_cap: 2.74e12,
            total_volume_24h: 9.8e10,
            total_market_cap_yesterday_percentage_change: -2.01,
            last_updated: "2026-10-15T00:00:00Z",
          },
        },
      });
    }
    if (path === "/v3/fear-and-greed/latest")
      return ok({
        value: 51,
        value_classification: "Neutral",
        update_time: "2026-10-15T00:00:00Z",
      });
    if (path === "/v1/altcoin-season-index/latest")
      return ok({ altcoin_index: 54, snapshot_time: "2026-10-15T00:00:00Z" });
    return undefined;
  });
}

describe("CoinMarketCap overview", () => {
  it("uses the keyless public route without a key", async () => {
    const ex = cmc();
    const g = await fetchCmcGlobal({ fetch: ex.fetch });
    expect(g).toMatchObject({
      totalMarketCapUsd: 2.74e12,
      btcDominance: 57.31,
      change24hPct: -2.01,
    });
    expect(ex.requests[0]?.url.pathname).toBe("/public-api/v1/global-metrics/quotes/latest");
    expect(ex.requests[0]?.headers["X-CMC_PRO_API_KEY"]).toBeUndefined();
  });

  it("uses the keyed route and header with a key", async () => {
    const ex = cmc();
    await fetchCmcFearGreed({ fetch: ex.fetch, apiKey: "cmc-key-0123456789" });
    expect(ex.requests[0]?.url.pathname).toBe("/v3/fear-and-greed/latest");
    expect(ex.requests[0]?.headers["X-CMC_PRO_API_KEY"]).toBe("cmc-key-0123456789");
  });

  it("reads Fear & Greed and the Altcoin Season Index", async () => {
    const ex = cmc();
    await expect(fetchCmcFearGreed({ fetch: ex.fetch })).resolves.toMatchObject({
      value: 51,
      label: "Neutral",
    });
    await expect(fetchCmcAltcoinSeason({ fetch: ex.fetch })).resolves.toMatchObject({ value: 54 });
  });

  it("raises CoinMarketCap errors", async () => {
    const ex = fakeExchange(() => ({
      status: 429,
      body: { status: { error_code: 1008, error_message: "rate limited" } },
    }));
    await expect(fetchCmcGlobal({ fetch: ex.fetch })).rejects.toThrow(/rate limited/);
  });
});
