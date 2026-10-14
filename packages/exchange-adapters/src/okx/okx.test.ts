import { describe, expect, it } from "vitest";
import { hmacSha256Base64 } from "../http.js";
import { canonicalSymbol } from "../symbols.js";
import { fakeExchange } from "../test-utils.js";
import { evaluateOkxPerm, OkxAdapter } from "./adapter.js";
import { OkxHistorySource, okxRecord } from "./history.js";

const creds = {
  apiKey: "okx-key-0123456789",
  apiSecret: "okx-secret-0123456789",
  passphrase: "Pass-1",
};
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0, 123);
const ok = (data: unknown) => ({ body: { code: "0", msg: "", data } });
const CONFIG = { uid: "44448888", perm: "read_only", ip: "" };

function okx(opts: { config?: unknown; host?: string } = {}) {
  return fakeExchange((url) => {
    if (opts.host && url.host !== opts.host)
      return {
        body: { code: "50101", msg: "APIKey does not match current environment.", data: [] },
      };
    if (url.pathname === "/api/v5/account/config") return ok([opts.config ?? CONFIG]);
    if (url.pathname === "/api/v5/account/positions") return ok([]);
    return undefined;
  });
}

describe("OKX signing", () => {
  it("signs timestamp + GET + path with query, base64", async () => {
    const ex = okx();
    await new OkxAdapter({
      fetch: ex.fetch,
      now: () => NOW,
      baseUrl: "https://www.okx.com",
    }).verifyCredentials(creds);
    const req = ex.requests[1];
    const ts = new Date(NOW).toISOString();
    expect(req?.headers["OK-ACCESS-TIMESTAMP"]).toBe(ts);
    expect(req?.headers["OK-ACCESS-SIGN"]).toBe(
      hmacSha256Base64(creds.apiSecret, `${ts}GET/api/v5/account/positions?instType=SWAP`),
    );
    expect(req?.headers["OK-ACCESS-PASSPHRASE"]).toBe("Pass-1");
  });
});

describe("OkxAdapter.verifyCredentials", () => {
  it("accepts a read-only key", async () => {
    const ex = okx();
    await expect(
      new OkxAdapter({ fetch: ex.fetch }).verifyCredentials(creds),
    ).resolves.toMatchObject({
      ok: true,
      externalAccountId: "44448888",
      ipRestricted: false,
    });
  });

  it("finds the account's regional host and keeps using it", async () => {
    const ex = okx({ host: "eea.okx.com" });
    const r = await new OkxAdapter({ fetch: ex.fetch }).verifyCredentials(creds);
    expect(r.ok).toBe(true);
    expect(ex.requests.map((q) => q.url.host)).toEqual([
      "www.okx.com",
      "eea.okx.com",
      "eea.okx.com",
    ]);
  });

  it("rejects trade and withdraw permissions", () => {
    expect(evaluateOkxPerm("read_only,trade,withdraw").problem).toEqual({
      code: "UNSAFE_PERMISSIONS",
      details: ["Trade", "Withdraw"],
    });
    expect(evaluateOkxPerm(undefined).problem?.code).toBe("UNVERIFIABLE_PERMISSIONS");
    expect(evaluateOkxPerm("").problem?.code).toBe("MISSING_PERMISSIONS");
  });

  it.each([
    ["50111", "INVALID_KEY"],
    ["50113", "INVALID_SECRET"],
    ["50105", "INVALID_PASSPHRASE"],
    ["50110", "IP_NOT_ALLOWED"],
    ["50011", "RATE_LIMITED"],
  ])("maps code %s to %s", async (code, expected) => {
    const ex = fakeExchange(() => ({
      status: code === "50011" ? 429 : 401,
      body: { code, msg: "x", data: [] },
    }));
    await expect(
      new OkxAdapter({ fetch: ex.fetch, baseUrl: "https://www.okx.com" }).verifyCredentials(creds),
    ).resolves.toMatchObject({ ok: false, code: expected });
  });
});

describe("OKX symbols and records", () => {
  it("maps swap instruments", () => {
    expect(canonicalSymbol("OKX", "BTC-USDT-SWAP")).toMatchObject({
      symbol: "BTCUSDT",
      settle: "USDT",
    });
    expect(canonicalSymbol("OKX", "BTC-USD-SWAP")).toMatchObject({
      symbol: "BTCUSD",
      inverse: true,
    });
  });

  it("converts contracts to coins and keeps OKX's own P&L", () => {
    const r = okxRecord({
      externalId: "1:2",
      symbol: "ETHUSDT",
      closed: true,
      closedAt: new Date(NOW),
      raw: {
        contractValue: "0.1",
        position: {
          instId: "ETH-USDT-SWAP",
          posId: "1",
          type: "2",
          cTime: String(NOW - 3_600_000),
          uTime: String(NOW),
          openAvgPx: "3000",
          closeAvgPx: "3100",
          openMaxPos: "20",
          closeTotalPos: "20",
          pnl: "200",
          fee: "-3.1",
          fundingFee: "-0.4",
          liqPenalty: "0",
          realizedPnl: "196.5",
          direction: "long",
          lever: "10",
        },
      },
    });
    expect(r).toMatchObject({
      direction: "LONG",
      quantity: "2",
      entryPrice: "3000",
      exitPrice: "3100",
      grossPnl: "200",
      fees: "3.1",
      funding: "-0.4",
      netPnl: "196.5",
      leverage: "10",
    });
  });

  it("pages position history back to the window start and marks partial closes open", async () => {
    const T = NOW;
    const row = (posId: string, uTime: number, type: string) => ({
      instId: "BTC-USDT-SWAP",
      posId,
      type,
      cTime: String(uTime - 1000),
      uTime: String(uTime),
      direction: "short",
    });
    const ex = fakeExchange((url) => {
      if (url.pathname === "/api/v5/public/instruments")
        return ok([{ instId: "BTC-USDT-SWAP", ctVal: "0.01" }]);
      if (url.pathname === "/api/v5/account/bills-archive")
        return ok([
          {
            billId: "9",
            instId: "BTC-USDT-SWAP",
            ccy: "USDT",
            balChg: "-0.2",
            ts: String(T - 50),
            type: "8",
          },
        ]);
      if (url.pathname !== "/api/v5/account/positions-history") return undefined;
      const after = Number(url.searchParams.get("after"));
      if (after > T)
        return ok([
          ...Array.from({ length: 99 }, (_, i) => row(`a${i}`, T - i, "2")),
          row("p", T - 99, "1"),
        ]);
      return ok([row("old", T - 5000, "2")]);
    });
    const src = new OkxHistorySource(creds, { fetch: ex.fetch, baseUrl: "https://www.okx.com" });
    const batch = await src.fetchHistory({ since: new Date(T - 2000), until: new Date(T) });
    expect(batch.positions).toHaveLength(100);
    expect(batch.positions.find((p) => p.externalId.startsWith("p:"))?.closed).toBe(false);
    expect(batch.income).toEqual([
      expect.objectContaining({ type: "FUNDING", amount: "-0.2", symbol: "BTCUSDT" }),
    ]);
  });
});
