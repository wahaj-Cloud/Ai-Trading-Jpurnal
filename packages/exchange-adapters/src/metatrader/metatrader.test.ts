import { describe, expect, it } from "vitest";
import { canonicalSymbol } from "../symbols.js";
import { MetatraderAdapter } from "./adapter.js";
import { MetatraderHistorySource, toRecord } from "./history.js";
import type { MetaApiDeal } from "./metaapi.js";
import { MetaApiClient } from "./metaapi.js";
import { type MetatraderMetadata, provisionStep } from "./provision.js";

type Handler = (req: {
  method: string;
  url: URL;
  body: unknown;
  headers: Record<string, string>;
}) => { status: number; body?: unknown } | undefined;

/** A fake MetaApi: provisioning and the regional client API on one base URL. */
function fakeMetaApi(handler: Handler) {
  const calls: { method: string; path: string; headers: Record<string, string> }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, headers });
    const hit = handler({ method, url, body, headers });
    if (!hit) return Response.json({ error: "NotFoundError" }, { status: 404 });
    if (hit.status === 204) return new Response(null, { status: 204 });
    return Response.json(hit.body ?? {}, { status: hit.status });
  }) as typeof fetch;
  const options = {
    token: "test-token",
    fetch: fetchFn,
    provisioningUrl: "https://prov.test",
    clientBaseUrl: (region: string) => `https://client.test/${region}`,
  };
  return { options, calls };
}

describe("canonicalSymbol (Exness MetaTrader)", () => {
  it.each([
    ["XAUUSDm", "XAUUSD", "XAU", "USD"],
    ["EURUSDc", "EURUSD", "EUR", "USD"],
    ["GBPJPY", "GBPJPY", "GBP", "JPY"],
    ["BTCUSDm", "BTCUSD", "BTC", "USD"],
    ["AAPLm", "AAPL", "AAPL", "USD"],
    ["USTECm", "USTEC", "USTEC", "USD"],
  ])("%s -> %s", (native, symbol, base, quote) => {
    expect(canonicalSymbol("EXNESS", native)).toEqual({
      symbol,
      base,
      quote,
      settle: "USD",
      inverse: false,
    });
  });
});

describe("provisionStep", () => {
  const creds = { login: "81234567", password: "investor-pw" };
  const ctx = { accountId: "acc-1", brokerName: "Exness", now: 1_000_000 };
  const base: MetatraderMetadata = {
    server: "Exness-MT5Real8",
    platform: "mt5",
    transactionId: "a".repeat(32),
  };

  it("creates, deploys, waits for the login, then proves investor mode", async () => {
    let createCalls = 0;
    let state = "UNDEPLOYED";
    let connection = "DISCONNECTED";
    let sentBody: Record<string, unknown> = {};
    const api = fakeMetaApi(({ method, url, body, headers }) => {
      if (method === "POST" && url.pathname === "/users/current/accounts") {
        createCalls++;
        sentBody = body as Record<string, unknown>;
        expect(headers["transaction-id"]).toBe("a".repeat(32));
        return createCalls === 1
          ? { status: 202, body: { metadata: { recommendedRetryTime: "2026-10-11T10:00:00Z" } } }
          : { status: 201, body: { id: "mt-1", state: "UNDEPLOYED" } };
      }
      if (method === "GET" && url.pathname === "/users/current/accounts/mt-1")
        return {
          status: 200,
          body: { _id: "mt-1", state, connectionStatus: connection, region: "london" },
        };
      if (method === "POST" && url.pathname === "/users/current/accounts/mt-1/deploy") {
        state = "DEPLOYING";
        return { status: 204 };
      }
      if (url.pathname === "/london/users/current/accounts/mt-1/account-information")
        return {
          status: 200,
          body: {
            platform: "mt5",
            currency: "USD",
            server: "Exness-MT5Real8",
            login: 81234567,
            investorMode: true,
            tradeAllowed: false,
            leverage: 500,
          },
        };
      return undefined;
    });
    const client = new MetaApiClient(api.options);

    let out = await provisionStep(client, base, creds, ctx);
    expect(out.status).toBe("PENDING"); // 202: broker detection still running
    expect(sentBody).toMatchObject({
      login: "81234567",
      server: "Exness-MT5Real8",
      platform: "mt5",
      type: "cloud-g2",
      magic: 0,
    });
    out = await provisionStep(client, out.metadata, creds, ctx);
    expect(out).toMatchObject({
      status: "PENDING",
      metadata: { metaapiAccountId: "mt-1", region: "london", deployRequestedAt: 1_000_000 },
    });
    state = "DEPLOYED";
    out = await provisionStep(client, out.metadata, creds, { ...ctx, now: ctx.now + 60_000 });
    expect(out.status).toBe("PENDING"); // deployed, not logged in yet
    connection = "CONNECTED";
    out = await provisionStep(client, out.metadata, creds, { ...ctx, now: ctx.now + 120_000 });
    expect(out).toMatchObject({ status: "READY", info: { investorMode: true, currency: "USD" } });
    expect(api.calls.every((c) => c.headers["auth-token"] === "test-token")).toBe(true);
  });

  it("refuses a trading (master) password and asks for removal", async () => {
    const api = fakeMetaApi(({ url }) => {
      if (url.pathname === "/users/current/accounts/mt-2")
        return {
          status: 200,
          body: { _id: "mt-2", state: "DEPLOYED", connectionStatus: "CONNECTED", region: "london" },
        };
      if (url.pathname.endsWith("/account-information"))
        return {
          status: 200,
          body: {
            platform: "mt5",
            currency: "USD",
            server: "x",
            login: 1,
            investorMode: false,
            tradeAllowed: true,
          },
        };
      return undefined;
    });
    const out = await provisionStep(
      new MetaApiClient(api.options),
      { ...base, metaapiAccountId: "mt-2" },
      creds,
      ctx,
    );
    expect(out).toMatchObject({
      status: "FAILED",
      remove: true,
      failure: { code: "UNSAFE_PERMISSIONS" },
    });
  });

  it("fails closed when investor mode is not reported", async () => {
    const api = fakeMetaApi(({ url }) => {
      if (url.pathname === "/users/current/accounts/mt-3")
        return {
          status: 200,
          body: { _id: "mt-3", state: "DEPLOYED", connectionStatus: "CONNECTED", region: "london" },
        };
      if (url.pathname.endsWith("/account-information"))
        return { status: 200, body: { platform: "mt5", currency: "USD", server: "x", login: 1 } };
      return undefined;
    });
    const out = await provisionStep(
      new MetaApiClient(api.options),
      { ...base, metaapiAccountId: "mt-3" },
      creds,
      ctx,
    );
    expect(out).toMatchObject({ status: "FAILED", failure: { code: "UNSAFE_PERMISSIONS" } });
  });

  it("explains a wrong server with the broker's own suggestions", async () => {
    const api = fakeMetaApi(() => ({
      status: 400,
      body: {
        error: "ValidationError",
        details: {
          code: "E_SRV_NOT_FOUND",
          serversByBrokers: {
            "Exness Technologies Ltd": ["Exness-MT5Real8", "Exness-MT5Real9"],
            Other: ["Other-Live"],
          },
        },
      },
    }));
    const out = await provisionStep(
      new MetaApiClient(api.options),
      { ...base, server: "Exnes-MT5" },
      creds,
      ctx,
    );
    expect(out).toMatchObject({
      status: "FAILED",
      remove: false,
      failure: { code: "INVALID_KEY" },
    });
    expect(out.status === "FAILED" && out.failure.details).toEqual([
      "Did you mean Exness-MT5Real8?",
      "Did you mean Exness-MT5Real9?",
    ]);
  });

  it("reports a rejected login", async () => {
    const api = fakeMetaApi(() => ({
      status: 400,
      body: { error: "ValidationError", details: "E_AUTH" },
    }));
    const out = await provisionStep(new MetaApiClient(api.options), base, creds, ctx);
    expect(out).toMatchObject({ status: "FAILED", failure: { code: "INVALID_SECRET" } });
  });

  it("gives up on a login that never connects", async () => {
    const api = fakeMetaApi(({ url }) =>
      url.pathname === "/users/current/accounts/mt-4"
        ? {
            status: 200,
            body: {
              _id: "mt-4",
              state: "DEPLOYED",
              connectionStatus: "DISCONNECTED_FROM_BROKER",
              region: "london",
            },
          }
        : undefined,
    );
    const meta = { ...base, metaapiAccountId: "mt-4", deployRequestedAt: 0 };
    const out = await provisionStep(new MetaApiClient(api.options), meta, creds, {
      ...ctx,
      now: 11 * 60_000,
    });
    expect(out).toMatchObject({
      status: "FAILED",
      remove: true,
      failure: { code: "INVALID_SECRET" },
    });
  });

  it("does nothing without a token", async () => {
    await expect(provisionStep(new MetaApiClient({}), base, creds, ctx)).rejects.toThrow(
      /not configured/,
    );
  });
});

describe("MetaTrader positions from deals", () => {
  const deal = (over: Partial<MetaApiDeal>): MetaApiDeal => ({
    id: "1",
    type: "DEAL_TYPE_BUY",
    entryType: "DEAL_ENTRY_IN",
    symbol: "XAUUSDm",
    time: "2026-10-01T08:00:00.000Z",
    volume: 0.1,
    price: 2400,
    commission: -0.7,
    swap: 0,
    profit: 0,
    positionId: "500",
    ...over,
  });
  const raw = (d: MetaApiDeal, currency = "USD") => ({
    deal: d,
    contractSize: 100,
    currency,
    leverage: 500,
  });

  it("builds a gold long from two entries and one exit, with commission and swap", () => {
    const r = toRecord("500", [
      raw(deal({ id: "1", price: 2400 })),
      raw(deal({ id: "2", price: 2410, time: "2026-10-01T09:00:00.000Z" })),
      raw(
        deal({
          id: "3",
          type: "DEAL_TYPE_SELL",
          entryType: "DEAL_ENTRY_OUT",
          volume: 0.2,
          price: 2420,
          commission: -1.4,
          swap: -2.5,
          profit: 300,
          time: "2026-10-02T10:00:00.000Z",
        }),
      ),
    ]);
    expect(r).toMatchObject({
      externalId: "P:500",
      symbol: "XAUUSD",
      direction: "LONG",
      closed: true,
      entryPrice: "2405",
      exitPrice: "2420",
      quantity: "20", // 0.2 lots x 100 oz
      grossPnl: "300",
      fees: "2.8",
      funding: "-2.5",
      netPnl: "294.7",
      settleAsset: "USD",
      incompleteHistory: false,
    });
  });

  it("keeps a position open until all volume is closed, and converts cent accounts", () => {
    const r = toRecord("600", [
      raw(deal({ id: "1", type: "DEAL_TYPE_SELL", volume: 1, positionId: "600" }), "USC"),
      raw(
        deal({
          id: "2",
          type: "DEAL_TYPE_BUY",
          entryType: "DEAL_ENTRY_OUT",
          volume: 0.4,
          profit: 1000,
          commission: 0,
          positionId: "600",
        }),
        "USC",
      ),
    ]);
    expect(r).toMatchObject({
      direction: "SHORT",
      closed: false,
      grossPnl: "10",
      fees: "0.007",
      settleAsset: "USD",
    });
  });

  it("flags a position whose opening deal is outside the history", () => {
    const r = toRecord("700", [
      raw(
        deal({
          id: "9",
          type: "DEAL_TYPE_SELL",
          entryType: "DEAL_ENTRY_OUT",
          profit: 50,
          positionId: "700",
        }),
      ),
    ]);
    expect(r).toMatchObject({
      direction: "LONG",
      closed: true,
      incompleteHistory: true,
      entryPrice: null,
    });
  });
});

describe("MetatraderHistorySource", () => {
  const routes: Handler = ({ url }) => {
    const p = url.pathname;
    if (p === "/users/current/accounts/mt-1")
      return {
        status: 200,
        body: { _id: "mt-1", state: "DEPLOYED", connectionStatus: "CONNECTED", region: "london" },
      };
    if (p.endsWith("/account-information"))
      return {
        status: 200,
        body: {
          platform: "mt5",
          currency: "USD",
          server: "Exness-MT5Real8",
          login: 1,
          investorMode: true,
          leverage: 200,
        },
      };
    if (p.includes("/symbols/") && p.endsWith("/specification"))
      return { status: 200, body: { symbol: "XAUUSDm", contractSize: 100 } };
    if (p.includes("/history-deals/time/"))
      return {
        status: 200,
        body: [
          { id: "1", type: "DEAL_TYPE_BALANCE", time: "2026-10-01T07:00:00.000Z", profit: 1000 },
          {
            id: "2",
            type: "DEAL_TYPE_BUY",
            entryType: "DEAL_ENTRY_IN",
            symbol: "XAUUSDm",
            time: "2026-10-01T08:00:00.000Z",
            volume: 0.1,
            price: 2400,
            commission: -0.35,
            profit: 0,
            positionId: "500",
          },
        ],
      };
    if (p.endsWith("/positions"))
      return {
        status: 200,
        body: [
          {
            id: 500,
            type: "POSITION_TYPE_BUY",
            symbol: "XAUUSDm",
            time: "2026-10-01T08:00:00.000Z",
            openPrice: 2400,
            currentPrice: 2412,
            volume: 0.1,
            unrealizedProfit: 120,
          },
        ],
      };
    return undefined;
  };

  it("stores trade deals (not deposits) and reports open positions in units", async () => {
    const api = fakeMetaApi(routes);
    const source = new MetatraderHistorySource(
      { apiKey: "81234567", apiSecret: "mt-1" },
      api.options,
    );
    const batch = await source.fetchHistory({
      since: new Date("2026-09-01"),
      until: new Date("2026-10-11"),
    });
    expect(batch.positions.map((p) => [p.externalId, p.symbol])).toEqual([["D:2", "XAUUSD"]]);
    expect(source.toRecords(batch.positions)[0]).toMatchObject({
      closed: false,
      quantity: "10",
      leverage: "200",
    });
    const open = await source.fetchOpenPositions();
    expect(open[0]).toMatchObject({
      symbol: "XAUUSD",
      direction: "LONG",
      quantity: "10",
      markPrice: "2412",
      unrealizedPnl: "120",
    });
  });

  it("verifies investor mode daily", async () => {
    const ok = await new MetatraderAdapter(fakeMetaApi(routes).options).verifyCredentials({
      apiKey: "1",
      apiSecret: "mt-1",
    });
    expect(ok).toMatchObject({
      ok: true,
      externalAccountId: "exness-mt5real8:1",
      permissions: { investorMode: true },
    });
  });
});
