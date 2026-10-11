// Local stand-in for KuCoin that verifies signatures and encrypted passphrases like the real API.

import { createHmac } from "node:crypto";
import { createServer } from "node:http";

const b64 = (secret, msg) => createHmac("sha256", secret).update(msg).digest("base64");

const keys = {
  kucoinreadaaaaaaaaaa: {
    secret: "kcsecretaaaaaaaaaaaa",
    passphrase: "Pass-123!",
    uid: 555,
    permission: "General",
  },
  kucointradeaaaaaaaaa: {
    secret: "kcsecretbbbbbbbbbbbb",
    passphrase: "Pass-456!",
    uid: 556,
    permission: "General,Futures",
  },
};

export function startFakeKucoin(port) {
  return createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const k = keys[req.headers["kc-api-key"]];
    if (!k) return send(401, { code: "400003", msg: "KC-API-KEY not exists" });

    const ts = req.headers["kc-api-timestamp"];
    if (req.headers["kc-api-sign"] !== b64(k.secret, `${ts}${req.method}${req.url}`)) {
      return send(401, { code: "400005", msg: "Signature error" });
    }
    if (req.headers["kc-api-passphrase"] !== b64(k.secret, k.passphrase)) {
      return send(401, { code: "400004", msg: "Invalid KC-API-PASSPHRASE" });
    }

    const path = new URL(req.url, "http://x").pathname;
    if (path === "/api/v1/user/api-key") {
      return send(200, {
        code: "200000",
        data: { permission: k.permission, uid: k.uid, apiVersion: 3 },
      });
    }
    if (path === "/api/v1/account-overview")
      return send(200, { code: "200000", data: { currency: "USDT" } });
    send(404, { code: "404000", msg: "not found" });
  }).listen(port);
}
