import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fakeExchange, networkDown } from "../test-utils.js";
import { MexcAdapter } from "./adapter.js";

const creds = { apiKey: "mx0vglTestKey0001", apiSecret: "secret-0123456789abcdef" };
const NOW = 1_790_000_000_000;
const READ_ONLY = "SPOT_ACCOUNT_READ,CONTRACT_ACCOUNT_READ,CONTRACT_DEAL_READ,";

function mexc(
  opts: {
    permissions?: unknown;
    status?: string;
    validity?: unknown;
    ip?: string;
    futures?: object;
  } = {},
) {
  return fakeExchange((url) => {
    if (url.pathname === "/api/v3/apiKeyInfo") {
      return {
        body: {
          apikey: creds.apiKey,
          status: opts.status ?? "VALID",
          permissions: "permissions" in opts ? opts.permissions : READ_ONLY,
          ipWhiteList: opts.ip ?? "",
          remainingValidity: opts.validity ?? "-999",
        },
      };
    }
    if (url.pathname === "/api/v3/uid") return { body: { uid: "98765432" } };
    if (url.pathname === "/api/v1/private/account/assets") {
      return { body: opts.futures ?? { success: true, code: 0, data: [] } };
    }
    return undefined;
  });
}

describe("MexcAdapter.verifyCredentials", () => {
  it("accepts a read-only key and reports account, IP lock and expiry", async () => {
    const ex = mexc({ ip: "203.0.113.7", validity: "30" });
    const result = await new MexcAdapter({ fetch: ex.fetch, now: () => NOW }).verifyCredentials(
      creds,
    );
    expect(result).toMatchObject({ ok: true, externalAccountId: "98765432", ipRestricted: true });
    expect(result.ok && result.keyExpiresAt?.getTime()).toBe(NOW + 30 * 86_400_000);
  });

  it("signs spot requests over the exact query string and futures requests over key+time+sorted query", async () => {
    const ex = mexc();
    await new MexcAdapter({ fetch: ex.fetch, now: () => NOW }).verifyCredentials(creds);

    const spot = ex.requests.find((r) => r.url.pathname === "/api/v3/apiKeyInfo");
    const query = spot?.url.search.slice(1) ?? "";
    const [signed, signature] = query.split("&signature=");
    expect(signed).toBe(`accessKey=${creds.apiKey}&recvWindow=10000&timestamp=${NOW}`);
    expect(signature).toBe(
      createHmac("sha256", creds.apiSecret)
        .update(signed ?? "")
        .digest("hex"),
    );
    expect(spot?.headers["X-MEXC-APIKEY"]).toBe(creds.apiKey);

    const fut = ex.requests.find((r) => r.url.pathname === "/api/v1/private/account/assets");
    expect(fut?.headers.Signature).toBe(
      createHmac("sha256", creds.apiSecret).update(`${creds.apiKey}${NOW}`).digest("hex"),
    );
    expect(fut?.headers["Request-Time"]).toBe(String(NOW));
  });

  it("rejects trading and withdrawal permissions by name, before any other call", async () => {
    const ex = mexc({ permissions: `${READ_ONLY}CONTRACT_DEAL_WRITE,SPOT_WITHDRAW_WRITE` });
    const result = await new MexcAdapter({ fetch: ex.fetch }).verifyCredentials(creds);
    expect(result).toMatchObject({
      ok: false,
      code: "UNSAFE_PERMISSIONS",
      details: ["Futures trading (CONTRACT_DEAL_WRITE)", "Withdrawals (SPOT_WITHDRAW_WRITE)"],
    });
    expect(ex.requests.map((r) => r.url.pathname)).toEqual(["/api/v3/apiKeyInfo"]);
  });

  it("treats unknown non-read permissions as unsafe", async () => {
    const ex = mexc({ permissions: `${READ_ONLY}NEW_POWER_WRITE` });
    await expect(
      new MexcAdapter({ fetch: ex.fetch }).verifyCredentials(creds),
    ).resolves.toMatchObject({
      code: "UNSAFE_PERMISSIONS",
      details: ["NEW_POWER_WRITE"],
    });
  });

  it("lists the futures read permissions that are missing", async () => {
    const ex = mexc({ permissions: "SPOT_ACCOUNT_READ" });
    await expect(
      new MexcAdapter({ fetch: ex.fetch }).verifyCredentials(creds),
    ).resolves.toMatchObject({
      code: "MISSING_PERMISSIONS",
      details: [
        "View futures account (CONTRACT_ACCOUNT_READ)",
        "View futures orders (CONTRACT_DEAL_READ)",
      ],
    });
  });

  it("fails closed when the permission list is absent", async () => {
    const ex = mexc({ permissions: undefined });
    await expect(
      new MexcAdapter({ fetch: ex.fetch }).verifyCredentials(creds),
    ).resolves.toMatchObject({
      code: "UNVERIFIABLE_PERMISSIONS",
    });
  });

  it.each([
    [{ status: "FROZEN" }, "KEY_EXPIRED"],
    [{ validity: 0 }, "KEY_EXPIRED"],
  ])("rejects keys the exchange no longer honours (%j)", async (opts, code) => {
    const ex = mexc(opts);
    await expect(
      new MexcAdapter({ fetch: ex.fetch }).verifyCredentials(creds),
    ).resolves.toMatchObject({ code });
  });

  it.each([
    [{ status: 400, body: { code: 10072, msg: "invalid access key" } }, "INVALID_KEY"],
    [
      { status: 400, body: { code: 700002, msg: "Signature for this request is not valid." } },
      "INVALID_SECRET",
    ],
    [{ status: 400, body: { code: 700006, msg: "IP non white list" } }, "IP_NOT_ALLOWED"],
    [
      { status: 403, body: { code: 700007, msg: "No permission to access the endpoint." } },
      "MISSING_PERMISSIONS",
    ],
    [{ status: 429, body: {} }, "RATE_LIMITED"],
    [
      { status: 400, body: { code: 700003, msg: "Timestamp outside recvWindow" } },
      "EXCHANGE_UNAVAILABLE",
    ],
  ])("maps spot error %j to %s", async (response, code) => {
    const ex = fakeExchange(() => response);
    await expect(
      new MexcAdapter({ fetch: ex.fetch }).verifyCredentials(creds),
    ).resolves.toMatchObject({ code });
  });

  it.each([
    [{ success: false, code: 401, message: "No authority" }, "FUTURES_UNAVAILABLE"],
    [{ success: false, code: 406, message: "IP not in whitelist" }, "IP_NOT_ALLOWED"],
    [{ success: false, code: 602, message: "Verify failed" }, "INVALID_SECRET"],
  ])("maps futures error %j (sent with HTTP 200) to %s", async (futures, code) => {
    const ex = mexc({ futures });
    await expect(
      new MexcAdapter({ fetch: ex.fetch }).verifyCredentials(creds),
    ).resolves.toMatchObject({ code });
  });

  it("maps network failures to a retryable message", async () => {
    await expect(
      new MexcAdapter({ fetch: networkDown }).verifyCredentials(creds),
    ).resolves.toMatchObject({
      code: "EXCHANGE_UNAVAILABLE",
    });
  });
});
