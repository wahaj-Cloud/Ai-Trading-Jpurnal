import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "../http.js";
import { fakeExchange, networkDown } from "../test-utils.js";
import { BingxAdapter } from "./adapter.js";

const creds = { apiKey: "bingx-key-0123456789", apiSecret: "bingx-secret-0123456789" };
const NOW = 1_790_000_000_000;

const READ_ONLY = {
  ipRestrict: false,
  createTime: 1_700_000_000_000,
  enableReading: true,
  enableSpotAndMarginTrading: false,
  enableWithdrawals: false,
  enableInternalTransfer: false,
  enableFutures: false,
  permitsUniversalTransfer: false,
  enableVanillaOptions: false,
};

function bingx(
  opts: { flags?: Record<string, unknown>; futures?: { status?: number; body: unknown } } = {},
) {
  return fakeExchange((url) => {
    if (url.pathname === "/openApi/v1/account/apiPermissions") {
      return { body: { code: 0, msg: "", data: opts.flags ?? READ_ONLY } };
    }
    if (url.pathname === "/openApi/account/v1/uid")
      return { body: { code: 0, msg: "", data: { uid: "1234567" } } };
    if (url.pathname === "/openApi/swap/v3/user/balance")
      return opts.futures ?? { body: { code: 0, data: [] } };
    return undefined;
  });
}

describe("BingX signing", () => {
  it("matches BingX's documented example signature", () => {
    const secret =
      "mheO6dR8ovSsxZQCOYEFCtelpuxcWGTfHw7te326y6jOwq5WpvFQ9JNljoTwBXZGv5It07m9RXSPpDQEK2w";
    expect(
      hmacSha256Hex(secret, "symbol=BTC-USDT&timestamp=1667872120843&side=LONG&leverage=6"),
    ).toBe("4f581ecdb1fa09b9d6e57886b6f70cffed17f82b93399722939e49a38edec2bf");
  });

  it("signs the sorted query it sends", async () => {
    const ex = bingx();
    await new BingxAdapter({ fetch: ex.fetch, now: () => NOW }).verifyCredentials(creds);
    const req = ex.requests[0];
    const [signed, signature] = (req?.url.search.slice(1) ?? "").split("&signature=");
    expect(signed).toBe(`timestamp=${NOW}`);
    expect(signature).toBe(hmacSha256Hex(creds.apiSecret, signed ?? ""));
    expect(req?.headers["X-BX-APIKEY"]).toBe(creds.apiKey);
  });
});

describe("BingxAdapter.verifyCredentials", () => {
  it("accepts a read-only key and returns the BingX UID", async () => {
    const ex = bingx();
    await expect(
      new BingxAdapter({ fetch: ex.fetch }).verifyCredentials(creds),
    ).resolves.toMatchObject({
      ok: true,
      externalAccountId: "1234567",
      ipRestricted: false,
    });
  });

  it("rejects trading and withdrawal permissions by name, before any other call", async () => {
    const ex = bingx({ flags: { ...READ_ONLY, enableFutures: true, enableWithdrawals: true } });
    const result = await new BingxAdapter({ fetch: ex.fetch }).verifyCredentials(creds);
    expect(result).toMatchObject({
      ok: false,
      code: "UNSAFE_PERMISSIONS",
      details: ["Withdraw", "Perpetual Futures Trading"],
    });
    expect(ex.requests).toHaveLength(1);
  });

  it("fails closed when BingX omits the withdrawal flag", async () => {
    const { enableWithdrawals: _omit, ...flags } = READ_ONLY;
    const ex = bingx({ flags });
    await expect(
      new BingxAdapter({ fetch: ex.fetch }).verifyCredentials(creds),
    ).resolves.toMatchObject({
      code: "UNVERIFIABLE_PERMISSIONS",
    });
  });

  it("asks for read access when it is off", async () => {
    const ex = bingx({ flags: { ...READ_ONLY, enableReading: false } });
    await expect(
      new BingxAdapter({ fetch: ex.fetch }).verifyCredentials(creds),
    ).resolves.toMatchObject({
      code: "MISSING_PERMISSIONS",
      details: ["Read"],
    });
  });

  it.each([
    [{ body: { code: 100413, msg: "Incorrect apiKey" } }, "INVALID_KEY"],
    [{ body: { code: 100001, msg: "Signature verification failed" } }, "INVALID_SECRET"],
    [{ body: { code: 100419, msg: "IP not in whitelist" } }, "IP_NOT_ALLOWED"],
    [{ body: { code: 100410, msg: "Rate limited" } }, "RATE_LIMITED"],
    [{ status: 429, body: {} }, "RATE_LIMITED"],
    [{ body: { code: 101484, msg: "Restricted region" } }, "ACCOUNT_RESTRICTED"],
    [{ body: { code: 100421, msg: "Timestamp mismatch" } }, "EXCHANGE_UNAVAILABLE"],
  ])("maps error %j to %s", async (response, code) => {
    const ex = fakeExchange(() => response);
    await expect(
      new BingxAdapter({ fetch: ex.fetch }).verifyCredentials(creds),
    ).resolves.toMatchObject({ code });
  });

  it("reports missing futures access distinctly", async () => {
    const ex = bingx({ futures: { body: { code: 100004, msg: "No permission" } } });
    await expect(
      new BingxAdapter({ fetch: ex.fetch }).verifyCredentials(creds),
    ).resolves.toMatchObject({
      code: "FUTURES_UNAVAILABLE",
    });
  });

  it("maps network failures to a retryable message", async () => {
    await expect(
      new BingxAdapter({ fetch: networkDown }).verifyCredentials(creds),
    ).resolves.toMatchObject({
      code: "EXCHANGE_UNAVAILABLE",
    });
  });
});
