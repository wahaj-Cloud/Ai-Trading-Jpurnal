// Local stand-in for Binance that verifies HMAC signatures exactly like the real API.

import { createHmac } from "node:crypto";
import { createServer } from "node:http";

const readOnly = {
  ipRestrict: false,
  enableReading: true,
  enableWithdrawals: false,
  enableSpotAndMarginTrading: false,
  enableFutures: false,
};
const keys = {
  good1aaaaaaaaaaaaaaa: { secret: "secret1aaaaaaaaaaaaa", uid: 111, r: readOnly },
  good1bbbbbbbbbbbbbbb: {
    secret: "secret1bbbbbbbbbbbbb",
    uid: 111,
    r: { ...readOnly, ipRestrict: true },
  },
  good2aaaaaaaaaaaaaaa: { secret: "secret2aaaaaaaaaaaaa", uid: 222, r: readOnly },
  good4aaaaaaaaaaaaaaa: { secret: "secret4aaaaaaaaaaaaa", uid: 444, r: readOnly },
  good5aaaaaaaaaaaaaaa: { secret: "secret5aaaaaaaaaaaaa", uid: 555, r: readOnly },
  tradeaaaaaaaaaaaaaaa: {
    secret: "secret3aaaaaaaaaaaaa",
    uid: 333,
    r: { ...readOnly, enableFutures: true, enableWithdrawals: true },
  },
};
export function startFakeBinance(port) {
  return createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (s, b) => {
      res.writeHead(s, { "content-type": "application/json" });
      res.end(JSON.stringify(b));
    };
    if (url.pathname === "/api/v3/time") return send(200, { serverTime: Date.now() });
    const k = keys[req.headers["x-mbx-apikey"]];
    if (!k)
      return send(401, { code: -2015, msg: "Invalid API-key, IP, or permissions for action." });
    const q = url.search.slice(1);
    const i = q.lastIndexOf("&signature=");
    if (createHmac("sha256", k.secret).update(q.slice(0, i)).digest("hex") !== q.slice(i + 11))
      return send(400, { code: -1022, msg: "Signature for this request is not valid." });
    if (url.pathname.endsWith("apiRestrictions")) return send(200, k.r);
    if (url.pathname === "/api/v3/account") return send(200, { uid: k.uid, balances: [] });
    if (url.pathname === "/fapi/v1/income") return send(200, []);
    send(404, { code: -1, msg: "not found" });
  }).listen(port);
}
