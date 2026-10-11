import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "../http.js";
import { BinanceAdapter } from "./adapter.js";
import { evaluateBinanceRestrictions } from "./permissions.js";

describe("Binance signing", () => {
  it("matches Binance's documented example signature", () => {
    const secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
    const query =
      "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
    expect(hmacSha256Hex(secret, query)).toBe(
      "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71",
    );
  });
});

const readOnly = {
  ipRestrict: true,
  enableReading: true,
  enableWithdrawals: false,
  enableSpotAndMarginTrading: false,
  enableFutures: false,
  enableMargin: false,
  enableInternalTransfer: false,
  permitsUniversalTransfer: false,
  enableVanillaOptions: false,
  tradingAuthorityExpirationTime: 1_700_000_000_000,
};

describe("evaluateBinanceRestrictions", () => {
  it("accepts a read-only key", () => {
    expect(evaluateBinanceRestrictions(readOnly)).toMatchObject({
      missing: [],
      unsafe: [],
      unreported: [],
    });
  });
  it("names every dangerous permission", () => {
    const r = evaluateBinanceRestrictions({
      ...readOnly,
      enableFutures: true,
      enableWithdrawals: true,
    });
    expect(r.unsafe).toEqual(["Enable Withdrawals", "Enable Futures"]);
  });
  it("treats unknown future permission flags as unsafe", () => {
    expect(evaluateBinanceRestrictions({ ...readOnly, enableNewThing: true }).unsafe).toEqual([
      "enableNewThing",
    ]);
  });
  it("fails closed when the withdrawal flag is not reported", () => {
    const { enableWithdrawals: _omit, ...rest } = readOnly;
    expect(evaluateBinanceRestrictions(rest).unreported).toEqual(["Enable Withdrawals"]);
  });
});

type Route = (url: URL) => { status: number; body: unknown };

function fakeFetch(route: Route): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v3/time") return Response.json({ serverTime: Date.now() });
    const { status, body } = route(url);
    return Response.json(body, { status });
  }) as typeof fetch;
}

const creds = { apiKey: "k".repeat(64), apiSecret: "s".repeat(64) };

describe("BinanceAdapter.verifyCredentials", () => {
  it("returns account ID and permission snapshot for a valid read-only key", async () => {
    const adapter = new BinanceAdapter({
      fetch: fakeFetch((url) => {
        if (url.pathname.endsWith("apiRestrictions")) return { status: 200, body: readOnly };
        if (url.pathname === "/api/v3/account") return { status: 200, body: { uid: 123456 } };
        return { status: 200, body: [] };
      }),
    });
    await expect(adapter.verifyCredentials(creds)).resolves.toMatchObject({
      ok: true,
      externalAccountId: "123456",
      ipRestricted: true,
    });
  });

  it("rejects trading keys before touching anything else", async () => {
    const calls: string[] = [];
    const adapter = new BinanceAdapter({
      fetch: fakeFetch((url) => {
        calls.push(url.pathname);
        return { status: 200, body: { ...readOnly, enableSpotAndMarginTrading: true } };
      }),
    });
    const result = await adapter.verifyCredentials(creds);
    expect(result).toMatchObject({
      ok: false,
      code: "UNSAFE_PERMISSIONS",
      details: ["Enable Spot & Margin Trading"],
    });
    expect(calls).toEqual(["/sapi/v1/account/apiRestrictions"]);
  });

  it.each([
    [
      {
        status: 401,
        body: { code: -2015, msg: "Invalid API-key, IP, or permissions for action." },
      },
      "INVALID_KEY",
    ],
    [
      { status: 400, body: { code: -1022, msg: "Signature for this request is not valid." } },
      "INVALID_SECRET",
    ],
    [
      { status: 451, body: { code: 0, msg: "Service unavailable from a restricted location" } },
      "RESTRICTED_LOCATION",
    ],
    [{ status: 429, body: { code: -1003, msg: "Too many requests" } }, "RATE_LIMITED"],
    [{ status: 502, body: {} }, "EXCHANGE_UNAVAILABLE"],
  ])("maps exchange error %j to %s", async (response, code) => {
    const adapter = new BinanceAdapter({ fetch: fakeFetch(() => response) });
    await expect(adapter.verifyCredentials(creds)).resolves.toMatchObject({ ok: false, code });
  });

  it("reports missing futures access distinctly", async () => {
    const adapter = new BinanceAdapter({
      fetch: fakeFetch((url) => {
        if (url.pathname.startsWith("/fapi"))
          return { status: 401, body: { code: -2015, msg: "denied" } };
        return {
          status: 200,
          body: url.pathname.endsWith("apiRestrictions") ? readOnly : { uid: 1 },
        };
      }),
    });
    await expect(adapter.verifyCredentials(creds)).resolves.toMatchObject({
      ok: false,
      code: "FUTURES_UNAVAILABLE",
    });
  });

  it("maps network failures without leaking details", async () => {
    const adapter = new BinanceAdapter({
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    await expect(adapter.verifyCredentials(creds)).resolves.toMatchObject({
      ok: false,
      code: "EXCHANGE_UNAVAILABLE",
    });
  });
});
