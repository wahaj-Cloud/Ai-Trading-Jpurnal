import { describe, expect, it } from "vitest";
import { computeLiquidationMap } from "./liq-map.js";

const STEP = 300_000;
const NOW = Date.UTC(2026, 9, 14, 12, 2, 0);
const LAST_OPEN = Math.floor(NOW / STEP) * STEP;
const opens = Array.from({ length: 288 }, (_, i) => LAST_OPEN - (287 - i) * STEP);
const price = (i: number) => 60_000 + Math.sin(i / 20) * 600;

/** Fake public endpoints in each exchange's own response format. */
function fakeMarkets(opts: { okxDown?: boolean } = {}) {
  const urls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    urls.push(url.host + url.pathname);
    const json = (body: unknown, status = 200) => Response.json(body, { status });
    if (url.pathname === "/fapi/v1/klines") {
      return json(
        opens.map((t, i) => [
          t,
          String(price(i)),
          String(price(i) + 80),
          String(price(i) - 80),
          String(price(i) + 10),
          "100",
          t + STEP - 1,
          "0",
          0,
          "70",
          "0",
          "0",
        ]),
      );
    }
    if (url.pathname === "/futures/data/openInterestHist") {
      return json(
        opens.map((t, i) => ({
          symbol: "BTCUSDT",
          sumOpenInterest: String(80_000 + i * 5),
          sumOpenInterestValue: "0",
          timestamp: t + STEP,
        })),
      );
    }
    if (url.pathname === "/v5/market/open-interest") {
      const list = opens
        .map((t, i) => ({ openInterest: String(50_000 + i * 3), timestamp: String(t) }))
        .reverse();
      return json({
        retCode: 0,
        retMsg: "OK",
        result: {
          symbol: "BTCUSDT",
          category: "linear",
          list: list.slice(0, 200),
          nextPageCursor: url.searchParams.get("cursor") ? "" : "next",
        },
      });
    }
    if (url.pathname === "/api/v5/rubik/stat/contracts/open-interest-history") {
      if (opts.okxDown)
        return json({ code: "51001", msg: "Instrument ID does not exist", data: [] }, 200);
      return json({
        code: "0",
        msg: "",
        data: opens
          .slice(-100)
          .reverse()
          .map((t, i) => [String(t), "1", String(30_000 + i), "0"]),
      });
    }
    return json({}, 404);
  }) as typeof fetch;
  return { fetch: fetchFn, urls };
}

describe("computeLiquidationMap", () => {
  it("combines all three exchanges into one encoded map", async () => {
    const m = fakeMarkets();
    const map = await computeLiquidationMap(
      { binance: { fetch: m.fetch }, bybit: { fetch: m.fetch }, okx: { fetch: m.fetch } },
      "BTCUSDT",
      "24h",
      NOW,
    );
    expect(map).not.toBeNull();
    expect(map?.sources).toEqual([
      { exchange: "BINANCE", ok: true },
      { exchange: "BYBIT", ok: true },
      { exchange: "OKX", ok: true },
    ]);
    expect(map?.count).toBe(288);
    expect(Buffer.from(map?.cells ?? "", "base64").length).toBe(288 * (map?.bins ?? 0));
    // 70% of volume was taker buying, so more value sits in long liquidations.
    expect(map?.totalLongUsd).toBeGreaterThan(map?.totalShortUsd ?? 0);
    expect(m.urls).toContain("www.okx.com/api/v5/rubik/stat/contracts/open-interest-history");
  });

  it("still builds a map when one exchange does not list the market", async () => {
    const m = fakeMarkets({ okxDown: true });
    const map = await computeLiquidationMap(
      { binance: { fetch: m.fetch }, bybit: { fetch: m.fetch }, okx: { fetch: m.fetch } },
      "XAUUSDT",
      "24h",
      NOW,
    );
    expect(map?.sources.find((s) => s.exchange === "OKX")).toEqual({ exchange: "OKX", ok: false });
    expect(map?.count).toBe(288);
  });
});
