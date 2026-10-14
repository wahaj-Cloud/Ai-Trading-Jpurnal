import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "../http.js";
import { canonicalSymbol } from "../symbols.js";
import { fakeExchange, networkDown } from "../test-utils.js";
import { BybitAdapter, evaluateBybitKey } from "./adapter.js";
import { type BybitExecution, BybitHistorySource, bybitFills } from "./history.js";

const creds = { apiKey: "bybit-key-0123456789", apiSecret: "bybit-secret-0123456789" };
const NOW = 1_790_000_000_000;

const READ_ONLY = {
  readOnly: 1,
  permissions: { ContractTrade: ["Order", "Position"], Spot: [], Wallet: [], Options: [] },
  ips: ["*"],
  expiredAt: "2026-12-30T00:00:00Z",
  userID: 24617703,
  uta: 1,
};

const ok = (result: unknown) => ({ body: { retCode: 0, retMsg: "OK", result, time: NOW } });

function bybit(opts: { info?: unknown; positions?: { status?: number; body: unknown } } = {}) {
  return fakeExchange((url) => {
    if (url.pathname === "/v5/user/query-api") return ok(opts.info ?? READ_ONLY);
    if (url.pathname === "/v5/position/list") return opts.positions ?? ok({ list: [] });
    return undefined;
  });
}

describe("Bybit signing", () => {
  it("signs timestamp + key + recvWindow + the query it sends", async () => {
    const ex = bybit();
    await new BybitAdapter({ fetch: ex.fetch, now: () => NOW }).verifyCredentials(creds);
    const req = ex.requests[1];
    const query = req?.url.search.slice(1) ?? "";
    expect(query).toBe("category=linear&settleCoin=USDT&limit=1");
    expect(req?.headers["X-BAPI-SIGN"]).toBe(
      hmacSha256Hex(creds.apiSecret, `${NOW}${creds.apiKey}10000${query}`),
    );
    expect(req?.headers["X-BAPI-API-KEY"]).toBe(creds.apiKey);
    expect(req?.headers["X-BAPI-TIMESTAMP"]).toBe(String(NOW));
  });
});

describe("BybitAdapter.verifyCredentials", () => {
  it("accepts a read-only key and reports its expiry when no IP is bound", async () => {
    const ex = bybit();
    const r = await new BybitAdapter({ fetch: ex.fetch }).verifyCredentials(creds);
    expect(r).toMatchObject({ ok: true, externalAccountId: "24617703", ipRestricted: false });
    expect(r.ok && r.keyExpiresAt?.toISOString()).toBe("2026-12-30T00:00:00.000Z");
  });

  it("does not report an expiry for IP-bound keys", async () => {
    const ex = bybit({ info: { ...READ_ONLY, ips: ["203.0.113.7"] } });
    const r = await new BybitAdapter({ fetch: ex.fetch }).verifyCredentials(creds);
    expect(r).toMatchObject({ ok: true, ipRestricted: true, keyExpiresAt: null });
  });

  it("rejects read-write keys before any other call", async () => {
    const ex = bybit({ info: { ...READ_ONLY, readOnly: 0 } });
    const r = await new BybitAdapter({ fetch: ex.fetch }).verifyCredentials(creds);
    expect(r).toMatchObject({ ok: false, code: "UNSAFE_PERMISSIONS" });
    expect(!r.ok && r.details).toContain("Read-Write (choose Read-Only)");
    expect(ex.requests).toHaveLength(1);
  });

  it("rejects wallet permissions even on read-only keys", () => {
    const e = evaluateBybitKey({
      ...READ_ONLY,
      permissions: { ...READ_ONLY.permissions, Wallet: ["Withdraw"] },
    });
    expect(e.problem).toEqual({ code: "UNSAFE_PERMISSIONS", details: ["Withdrawal"] });
  });

  it("asks for contract permissions when the key cannot read positions", () => {
    const e = evaluateBybitKey({
      ...READ_ONLY,
      permissions: { ContractTrade: [], Spot: ["SpotTrade"] },
    });
    expect(e.problem?.code).toBe("MISSING_PERMISSIONS");
  });

  it("refuses to judge a key whose permissions are not reported", () => {
    expect(evaluateBybitKey({ userID: 1 }).problem?.code).toBe("UNVERIFIABLE_PERMISSIONS");
  });

  it.each([
    [10003, "INVALID_KEY"],
    [10004, "INVALID_SECRET"],
    [10010, "IP_NOT_ALLOWED"],
    [33004, "KEY_EXPIRED"],
    [10006, "RATE_LIMITED"],
    [10002, "EXCHANGE_UNAVAILABLE"],
  ])("maps retCode %s to %s", async (retCode, code) => {
    const ex = fakeExchange(() => ({ body: { retCode, retMsg: "x", result: {} } }));
    await expect(
      new BybitAdapter({ fetch: ex.fetch }).verifyCredentials(creds),
    ).resolves.toMatchObject({ ok: false, code });
  });

  it("treats a CDN 403 as a server-region problem", async () => {
    const ex = fakeExchange(() => ({ status: 403, body: "blocked" }));
    await expect(
      new BybitAdapter({ fetch: ex.fetch }).verifyCredentials(creds),
    ).resolves.toMatchObject({ ok: false, code: "RESTRICTED_LOCATION" });
  });

  it("reports an unreachable exchange", async () => {
    await expect(
      new BybitAdapter({ fetch: networkDown }).verifyCredentials(creds),
    ).resolves.toMatchObject({ ok: false, code: "EXCHANGE_UNAVAILABLE" });
  });
});

const exec = (o: Partial<BybitExecution>): BybitExecution => ({
  symbol: "BTCUSDT",
  execId: "e1",
  orderId: "o1",
  side: "Buy",
  execPrice: "60000",
  execQty: "0.2",
  execFee: "0.6",
  feeCurrency: "USDT",
  execType: "Trade",
  execTime: String(NOW),
  isMaker: false,
  closedSize: "0",
  ...o,
});

describe("bybitFills", () => {
  it("opens a long on a buy that closes nothing", () => {
    expect(bybitFills(exec({}), "USDT")).toEqual([
      expect.objectContaining({
        exchangeFillId: "e1",
        side: "BUY",
        positionSide: "LONG",
        qty: "0.2",
        fee: "0.6",
      }),
    ]);
  });

  it("closes a long on a sell that closes it all", () => {
    expect(bybitFills(exec({ side: "Sell", closedSize: "0.2" }), "USDT")).toEqual([
      expect.objectContaining({ side: "SELL", positionSide: "LONG", qty: "0.2" }),
    ]);
  });

  it("splits a one-way flip into a close and an open, sharing the fee", () => {
    const fills = bybitFills(
      exec({ side: "Sell", execQty: "0.3", closedSize: "0.1", execFee: "0.9" }),
      "USDT",
    );
    expect(fills).toEqual([
      expect.objectContaining({
        exchangeFillId: "e1:close",
        positionSide: "LONG",
        qty: "0.1",
        fee: "0.3",
      }),
      expect.objectContaining({
        exchangeFillId: "e1:open",
        positionSide: "SHORT",
        qty: "0.2",
        fee: "0.6",
      }),
    ]);
  });

  it("maps USDC perpetual names to the journal symbol", () => {
    expect(bybitFills(exec({ symbol: "ETHPERP" }), "USDC")[0]?.symbol).toBe("ETHUSDC");
    expect(canonicalSymbol("BYBIT", "BTCPERP")).toMatchObject({
      symbol: "BTCUSDC",
      settle: "USDC",
    });
  });
});

describe("BybitHistorySource", () => {
  it("pages executions, keeps trades and funding, and skips dated futures", async () => {
    const pages: Record<string, unknown> = {
      "": {
        list: [
          exec({ execId: "a" }),
          exec({ execId: "f", execType: "Funding", execFee: "1.25", execQty: "0" }),
          exec({ execId: "d", symbol: "BTCUSDT-27DEC24" }),
        ],
        nextPageCursor: "p2",
      },
      p2: { list: [exec({ execId: "b", side: "Sell", closedSize: "0.2" })], nextPageCursor: "" },
    };
    const ex = fakeExchange((url) => {
      if (url.pathname !== "/v5/execution/list") return undefined;
      if (url.searchParams.get("settleCoin") === "USDC") {
        return { body: { retCode: 10001, retMsg: "params error", result: {} } };
      }
      return ok(pages[url.searchParams.get("cursor") ?? ""]);
    });
    const src = new BybitHistorySource(creds, { fetch: ex.fetch });
    const batch = await src.fetchHistory({ since: new Date(NOW - 1000), until: new Date(NOW) });
    expect(batch.fills.map((f) => f.exchangeFillId)).toEqual(["a", "b"]);
    expect(batch.income).toEqual([
      expect.objectContaining({
        type: "FUNDING",
        amount: "-1.25",
        symbol: "BTCUSDT",
        asset: "USDT",
      }),
    ]);
  });

  it("reads open positions in both modes", async () => {
    const ex = fakeExchange((url) => {
      if (url.pathname !== "/v5/position/list") return undefined;
      if (url.searchParams.get("settleCoin") === "USDC") return ok({ list: [] });
      return ok({
        list: [
          {
            symbol: "BTCUSDT",
            positionIdx: 0,
            side: "Sell",
            size: "0.5",
            avgPrice: "61000",
            markPrice: "60000",
            unrealisedPnl: "500",
            leverage: "10",
            liqPrice: "66000",
            tradeMode: 0,
            createdTime: String(NOW),
          },
          { symbol: "ETHUSDT", positionIdx: 0, side: "", size: "0" },
        ],
      });
    });
    const open = await new BybitHistorySource(creds, { fetch: ex.fetch }).fetchOpenPositions();
    expect(open).toEqual([
      expect.objectContaining({
        symbol: "BTCUSDT",
        direction: "SHORT",
        quantity: "0.5",
        liquidationPrice: "66000",
        marginMode: "CROSS",
      }),
    ]);
  });
});

describe("Bybit fills through the trade engine", () => {
  const toEngine = (f: ReturnType<typeof bybitFills>[number]) => ({
    id: f.exchangeFillId,
    symbol: f.symbol,
    side: f.side,
    positionSide: f.positionSide,
    price: f.price,
    qty: f.qty,
    fee: f.fee,
    realizedPnl: f.realizedPnl,
    executedAt: f.executedAt,
  });

  it("rebuilds a long, then the short a one-way flip opened", async () => {
    const { reconstructPositions } = await import("@atc/trade-engine");
    const fills = [
      exec({
        execId: "1",
        side: "Buy",
        execPrice: "60000",
        execQty: "0.2",
        closedSize: "0",
        execFee: "0",
        execTime: String(NOW),
      }),
      exec({
        execId: "2",
        side: "Sell",
        execPrice: "61000",
        execQty: "0.3",
        closedSize: "0.2",
        execFee: "0",
        execTime: String(NOW + 60_000),
      }),
      exec({
        execId: "3",
        side: "Buy",
        execPrice: "60500",
        execQty: "0.1",
        closedSize: "0.1",
        execFee: "0",
        execTime: String(NOW + 120_000),
      }),
    ].flatMap((e) => bybitFills(e, "USDT").map(toEngine));
    const positions = reconstructPositions(fills);
    expect(positions.map((p) => [p.direction, p.status, p.grossPnl])).toEqual([
      ["LONG", "CLOSED", "200"],
      ["SHORT", "CLOSED", "50"],
    ]);
  });

  it("keeps hedge-mode long and short apart", async () => {
    const { reconstructPositions } = await import("@atc/trade-engine");
    const fills = [
      exec({
        execId: "1",
        side: "Buy",
        execPrice: "100",
        execQty: "1",
        closedSize: "0",
        execFee: "0",
        execTime: String(NOW),
      }),
      exec({
        execId: "2",
        side: "Sell",
        execPrice: "100",
        execQty: "1",
        closedSize: "0",
        execFee: "0",
        execTime: String(NOW + 1),
      }),
      exec({
        execId: "3",
        side: "Sell",
        execPrice: "110",
        execQty: "1",
        closedSize: "1",
        execFee: "0",
        execTime: String(NOW + 2),
      }),
      exec({
        execId: "4",
        side: "Buy",
        execPrice: "110",
        execQty: "1",
        closedSize: "1",
        execFee: "0",
        execTime: String(NOW + 3),
      }),
    ].flatMap((e) => bybitFills(e, "USDT").map(toEngine));
    const byDir = Object.fromEntries(
      reconstructPositions(fills).map((p) => [p.direction, p.grossPnl]),
    );
    expect(byDir).toEqual({ LONG: "10", SHORT: "-10" });
  });
});
