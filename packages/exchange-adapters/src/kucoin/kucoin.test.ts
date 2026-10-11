import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fakeExchange, networkDown } from "../test-utils.js";
import { KucoinAdapter } from "./adapter.js";

const creds = {
  apiKey: "68d4a2645aaa3841d",
  apiSecret: "kucoin-secret-0123456789",
  passphrase: "My-Pass_123",
};
const NOW = 1_790_000_000_000;
const b64 = (msg: string) => createHmac("sha256", creds.apiSecret).update(msg).digest("base64");

function kucoin(
  opts: { permission?: unknown; futures?: { status?: number; body: unknown }; extra?: object } = {},
) {
  return fakeExchange((url) => {
    if (url.pathname === "/api/v1/user/api-key") {
      return {
        body: {
          code: "200000",
          data: {
            permission: "permission" in opts ? opts.permission : "General",
            uid: 165_000_215,
            apiVersion: 3,
            ...opts.extra,
          },
        },
      };
    }
    if (url.pathname === "/api/v1/account-overview") {
      return (
        opts.futures ?? { body: { code: "200000", data: { currency: "USDT", accountEquity: 0 } } }
      );
    }
    return undefined;
  });
}

const options = (ex: ReturnType<typeof kucoin>) => ({
  fetch: ex.fetch,
  now: () => NOW,
  spotBaseUrl: "https://spot.test",
  futuresBaseUrl: "https://futures.test",
});

describe("KucoinAdapter.verifyCredentials", () => {
  it("accepts a General-only key and returns the KuCoin UID", async () => {
    const ex = kucoin();
    await expect(new KucoinAdapter(options(ex)).verifyCredentials(creds)).resolves.toMatchObject({
      ok: true,
      externalAccountId: "165000215",
      ipRestricted: null,
      permissions: { General: true },
    });
  });

  it("signs timestamp + method + path?query and sends the passphrase encrypted", async () => {
    const ex = kucoin();
    await new KucoinAdapter(options(ex)).verifyCredentials(creds);

    const info = ex.requests[0];
    expect(info?.url.origin).toBe("https://spot.test");
    expect(info?.headers["KC-API-SIGN"]).toBe(b64(`${NOW}GET/api/v1/user/api-key`));
    expect(info?.headers["KC-API-PASSPHRASE"]).toBe(b64(creds.passphrase));
    expect(info?.headers["KC-API-PASSPHRASE"]).not.toContain(creds.passphrase);
    expect(info?.headers["KC-API-KEY-VERSION"]).toBe("2");

    const fut = ex.requests[1];
    expect(fut?.url.origin).toBe("https://futures.test");
    expect(fut?.headers["KC-API-SIGN"]).toBe(
      b64(`${NOW}GET/api/v1/account-overview?currency=USDT`),
    );
  });

  it("rejects every trading, transfer and withdrawal permission by name", async () => {
    const ex = kucoin({
      permission: "General,Futures,Unified,Spot,Earn,InnerTransfer,Margin,Withdrawal",
    });
    const result = await new KucoinAdapter(options(ex)).verifyCredentials(creds);
    expect(result).toMatchObject({
      ok: false,
      code: "UNSAFE_PERMISSIONS",
      details: [
        "Futures Trading",
        "Unified Account Trading",
        "Spot Trading",
        "Earn",
        "Inner Transfer",
        "Margin Trading",
        "Withdrawal",
      ],
    });
    expect(ex.requests).toHaveLength(1);
  });

  it("requires the passphrase before calling KuCoin", async () => {
    const ex = kucoin();
    const { passphrase: _omit, ...noPassphrase } = creds;
    await expect(
      new KucoinAdapter(options(ex)).verifyCredentials(noPassphrase),
    ).resolves.toMatchObject({
      code: "INVALID_PASSPHRASE",
    });
    expect(ex.requests).toHaveLength(0);
  });

  it("fails closed when the permission field is missing", async () => {
    const ex = kucoin({ permission: undefined });
    await expect(new KucoinAdapter(options(ex)).verifyCredentials(creds)).resolves.toMatchObject({
      code: "UNVERIFIABLE_PERMISSIONS",
    });
  });

  it("reports the IP whitelist when KuCoin includes it", async () => {
    const ex = kucoin({ extra: { ipWhitelist: "203.0.113.7" } });
    await expect(new KucoinAdapter(options(ex)).verifyCredentials(creds)).resolves.toMatchObject({
      ipRestricted: true,
    });
  });

  it.each([
    [{ status: 401, body: { code: "400003", msg: "KC-API-KEY not exists" } }, "INVALID_KEY"],
    [
      { status: 401, body: { code: "400004", msg: "Invalid KC-API-PASSPHRASE" } },
      "INVALID_PASSPHRASE",
    ],
    [{ status: 401, body: { code: "400005", msg: "Signature error" } }, "INVALID_SECRET"],
    [{ status: 403, body: { code: "400006", msg: "Invalid request ip" } }, "IP_NOT_ALLOWED"],
    [{ status: 403, body: { code: "400007", msg: "Access denied" } }, "MISSING_PERMISSIONS"],
    [{ status: 403, body: { code: "411100", msg: "User is frozen" } }, "ACCOUNT_RESTRICTED"],
    [{ status: 429, body: { code: "429000", msg: "Too many requests" } }, "RATE_LIMITED"],
    [
      { status: 401, body: { code: "400002", msg: "Invalid KC-API-TIMESTAMP" } },
      "EXCHANGE_UNAVAILABLE",
    ],
  ])("maps key-info error %j to %s", async (response, code) => {
    const ex = fakeExchange(() => response);
    await expect(new KucoinAdapter(options(ex)).verifyCredentials(creds)).resolves.toMatchObject({
      code,
    });
  });

  it("reports missing futures access distinctly", async () => {
    const ex = kucoin({ futures: { status: 403, body: { code: "400007", msg: "Access denied" } } });
    await expect(new KucoinAdapter(options(ex)).verifyCredentials(creds)).resolves.toMatchObject({
      code: "FUTURES_UNAVAILABLE",
    });
  });

  it("maps network failures to a retryable message", async () => {
    await expect(
      new KucoinAdapter({ fetch: networkDown }).verifyCredentials(creds),
    ).resolves.toMatchObject({
      code: "EXCHANGE_UNAVAILABLE",
    });
  });
});
