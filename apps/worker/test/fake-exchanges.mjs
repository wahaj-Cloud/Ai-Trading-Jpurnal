// Stand-ins for Binance and MEXC that behave like the real APIs for the endpoints the worker uses:
// signed requests are verified, time windows and pages are honoured, and state can be changed
// between syncs to simulate new trades, revoked keys or keys that gained trading rights.
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

const hex = (secret, msg) => createHmac("sha256", secret).update(msg).digest("hex");

function reply(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function startFakeBinance(port, state) {
  return createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/v3/time") return reply(res, 200, { serverTime: Date.now() });
    const key = state.keys[req.headers["x-mbx-apikey"]];
    if (!key || key.revoked)
      return reply(res, 401, {
        code: -2015,
        msg: "Invalid API-key, IP, or permissions for action.",
      });
    const q = url.search.slice(1);
    const i = q.lastIndexOf("&signature=");
    if (hex(key.secret, q.slice(0, i)) !== q.slice(i + 11))
      return reply(res, 400, { code: -1022, msg: "bad sig" });

    const p = url.searchParams;
    const inWindow = (t) => t >= Number(p.get("startTime")) && t <= Number(p.get("endTime"));
    state.requests.push(url.pathname);
    switch (url.pathname) {
      case "/sapi/v1/account/apiRestrictions":
        return reply(res, 200, key.restrictions);
      case "/api/v3/account":
        return reply(res, 200, { uid: key.uid });
      case "/fapi/v1/income": {
        const page = Number(p.get("page") ?? 1);
        const limit = Number(p.get("limit"));
        const rows = state.income.filter((r) => inWindow(r.time));
        return reply(res, 200, rows.slice((page - 1) * limit, page * limit));
      }
      case "/fapi/v3/positionRisk":
        return reply(res, 200, state.openPositions);
      case "/fapi/v1/userTrades": {
        if (Number(p.get("endTime")) - Number(p.get("startTime")) > 7 * 86_400_000) {
          return reply(res, 400, { code: -4166, msg: "More than 7 days" });
        }
        const rows = state.trades.filter((t) => t.symbol === p.get("symbol") && inWindow(t.time));
        return reply(res, 200, rows.slice(0, Number(p.get("limit"))));
      }
      default:
        return reply(res, 404, { code: -1, msg: "not found" });
    }
  }).listen(port);
}

export function startFakeMexc(port, state) {
  return createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/v1/contract/detail") {
      return reply(res, 200, {
        success: true,
        code: 0,
        data: [{ symbol: "BTC_USDT", contractSize: 0.0001 }],
      });
    }
    if (url.pathname === "/api/v1/contract/ticker") {
      if (state.tickerDown) return reply(res, 503, { code: 503, msg: "Service Unavailable" });
      return reply(res, 200, { success: true, code: 0, data: state.tickers ?? [] });
    }
    if (state.down) return reply(res, 503, { code: 503, msg: "Service Unavailable" });
    const spotKey = req.headers["x-mexc-apikey"];
    const futKey = req.headers.apikey;
    const key = state.keys[spotKey ?? futKey];
    if (!key) return reply(res, 400, { code: 10072, msg: "invalid access key" });
    state.requests.push(url.pathname);

    if (url.pathname.startsWith("/api/v1/private/")) {
      const signed = hex(
        key.secret,
        `${futKey}${req.headers["request-time"]}${url.search.slice(1)}`,
      );
      if (signed !== req.headers.signature)
        return reply(res, 200, { success: false, code: 602, message: "Verify failed" });
      if (url.pathname === "/api/v1/private/account/assets")
        return reply(res, 200, { success: true, code: 0, data: [] });
      if (url.pathname === "/api/v1/private/position/open_positions")
        return reply(res, 200, { success: true, code: 0, data: state.openPositions ?? [] });
      if (url.pathname === "/api/v1/private/position/list/history_positions") {
        const page = Number(url.searchParams.get("page_num"));
        const size = Number(url.searchParams.get("page_size"));
        const sorted = [...state.positions].sort(
          (a, b) => Number(b.updateTime) - Number(a.updateTime),
        );
        return reply(res, 200, {
          success: true,
          code: "0",
          data: sorted.slice((page - 1) * size, page * size),
        });
      }
      return reply(res, 404, { success: false, code: 404, message: "not found" });
    }

    const q = url.search.slice(1);
    const i = q.lastIndexOf("&signature=");
    if (hex(key.secret, q.slice(0, i)) !== q.slice(i + 11))
      return reply(res, 400, { code: 700002, msg: "bad sig" });
    if (url.pathname === "/api/v3/apiKeyInfo") {
      return reply(res, 200, {
        status: "VALID",
        permissions: key.permissions,
        ipWhiteList: "",
        remainingValidity: "-999",
      });
    }
    if (url.pathname === "/api/v3/uid") return reply(res, 200, { uid: key.uid });
    return reply(res, 404, { code: -1, msg: "not found" });
  }).listen(port);
}

/**
 * Stand-in for MetaApi (provisioning + regional client API on one port, region "london"):
 * accounts start undeployed, log in when deployed, and report investor mode only for passwords
 * that are not the master password. Deals and positions come from `state`.
 */
export function startFakeMetaApi(port, state) {
  return createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const p = url.pathname;
      state.requests.push(`${req.method} ${p}`);
      if (req.headers["auth-token"] !== state.token)
        return reply(res, 401, { error: "UnauthorizedError" });
      if (req.method === "POST" && p === "/users/current/accounts") {
        const body = JSON.parse(raw);
        if (body.password === "wrong-password")
          return reply(res, 400, { error: "ValidationError", details: "E_AUTH" });
        state.seq += 1;
        const id = `mt-${state.seq}`;
        state.accounts[id] = {
          state: "UNDEPLOYED",
          connectionStatus: "DISCONNECTED",
          investor: body.password !== state.masterPassword,
          login: body.login,
          server: body.server,
        };
        return reply(res, 201, { id, state: "UNDEPLOYED" });
      }
      const acc = /^\/users\/current\/accounts\/([^/]+)(\/(deploy|undeploy))?$/.exec(p);
      if (acc) {
        const a = state.accounts[acc[1]];
        if (req.method === "DELETE") {
          state.deleted.push(acc[1]);
          delete state.accounts[acc[1]];
          res.writeHead(204).end();
          return;
        }
        if (!a) return reply(res, 404, { error: "NotFoundError" });
        if (acc[3] === "deploy") {
          a.state = "DEPLOYED";
          a.connectionStatus = "CONNECTED";
          res.writeHead(204).end();
          return;
        }
        if (acc[3] === "undeploy") {
          a.state = "UNDEPLOYED";
          a.connectionStatus = "DISCONNECTED";
          res.writeHead(204).end();
          return;
        }
        return reply(res, 200, {
          _id: acc[1],
          state: a.state,
          connectionStatus: a.connectionStatus,
          region: "london",
        });
      }
      const client = /^\/london\/users\/current\/accounts\/([^/]+)\/(.*)$/.exec(p);
      if (client) {
        const a = state.accounts[client[1]];
        if (a?.state !== "DEPLOYED") return reply(res, 404, { error: "NotFoundError" });
        const rest = client[2];
        if (rest === "account-information")
          return reply(res, 200, {
            platform: "mt5",
            currency: state.currency,
            server: a.server,
            login: Number(a.login),
            leverage: 500,
            investorMode: a.investor,
            tradeAllowed: !a.investor,
          });
        if (rest === "positions") return reply(res, 200, state.positions);
        const spec = /^symbols\/([^/]+)\/specification$/.exec(rest);
        if (spec)
          return reply(res, 200, {
            symbol: decodeURIComponent(spec[1]),
            contractSize: decodeURIComponent(spec[1]).startsWith("XAU") ? 100 : 100000,
          });
        const deals = /^history-deals\/time\/([^/]+)\/([^/]+)$/.exec(rest);
        if (deals) {
          const from = Date.parse(decodeURIComponent(deals[1]));
          const to = Date.parse(decodeURIComponent(deals[2]));
          const offset = Number(url.searchParams.get("offset") ?? 0);
          const limit = Number(url.searchParams.get("limit") ?? 1000);
          const rows = state.deals.filter(
            (d) => Date.parse(d.time) >= from && Date.parse(d.time) < to,
          );
          return reply(res, 200, rows.slice(offset, offset + limit));
        }
      }
      return reply(res, 404, { error: "NotFoundError" });
    });
  }).listen(port);
}
