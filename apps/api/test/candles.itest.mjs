// Integration test: coin-card candles through our API. A stand-in for Binance counts requests;
// a real Redis holds the shared cache. Checks: one Binance request per coin and timeframe until
// the next candle closes (shared across "instances" and concurrent visitors), a late exchange is
// retried within seconds, unknown coins are remembered, and an outage is reported, not cached.
import "reflect-metadata";
import assert from "node:assert/strict";
import { ExchangeHttpError } from "@atc/exchange-adapters";
import { CARD_CANDLES, cardCandlesTtlMs } from "@atc/shared";
import { Redis } from "ioredis";
import { CandlesService } from "../dist/market/candles.service.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const STEP = { "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000 };
const NOW = Date.UTC(2026, 9, 23, 10, 7, 30);

const calls = [];
let mode = "ok";
const fetcher = async (symbol, tf, limit, now) => {
  calls.push(`${symbol}:${tf}`);
  await new Promise((r) => setTimeout(r, 20));
  if (symbol === "NOPEUSDT") throw new ExchangeHttpError(400, -1121, "Invalid symbol.");
  if (mode === "down") throw new Error("socket hang up");
  const step = STEP[tf];
  // "late": the candle that just closed is not published yet.
  const lastOpen = Math.floor(now / step) * step - step * (mode === "late" ? 2 : 1);
  return Array.from({ length: limit }, (_, i) => {
    const t = lastOpen - (limit - 1 - i) * step;
    return [t, 100 + i, 101 + i, 99 + i, 100.5 + i, 10];
  });
};
const env = { NODE_ENV: "test", REDIS_URL: "redis://unused" };
const make = () => {
  const s = new CandlesService(env);
  s.connect(redis, fetcher);
  return s;
};
const keys = (sym) => ["15m", "1h", "4h"].map((tf) => `cc:v1:${sym}:${tf}`);
for (const s of ["BTCUSDT", "XAUUSDT", "NOPEUSDT", "ETHUSDT"]) await redis.del(...keys(s));

// Many visitors at once on one instance, then another instance: three Binance requests in all.
const a = make();
const b = make();
const results = await Promise.all(Array.from({ length: 8 }, () => a.coin("BTCUSDT", NOW)));
const again = await b.coin("BTCUSDT", NOW + 1000);
assert.equal(calls.filter((c) => c.startsWith("BTCUSDT")).length, 3);
for (const r of [...results, again]) {
  assert.equal(r.symbol, "BTCUSDT");
  for (const tf of ["15m", "1h", "4h"]) {
    assert.equal(r.candles[tf].length, CARD_CANDLES[tf]);
    const last = r.candles[tf].at(-1);
    assert.equal(
      last[0],
      Math.floor(NOW / STEP[tf]) * STEP[tf] - STEP[tf],
      `${tf} ends at the last close`,
    );
    assert.ok(last[0] + STEP[tf] <= NOW, "closed candles only");
  }
}
// Cached until a few seconds after the next close.
for (const tf of ["15m", "1h", "4h"]) {
  const ttl = await redis.pttl(`cc:v1:BTCUSDT:${tf}`);
  const want = cardCandlesTtlMs(tf, NOW);
  assert.ok(ttl <= want && ttl > want - 5_000, `${tf} ttl ${ttl} vs ${want}`);
}
console.log("✓ one Binance request per coin and timeframe per candle, shared by every visitor");

// A late exchange: kept only briefly so the new candle appears seconds later.
mode = "late";
await a.coin("XAUUSDT", NOW);
const lateTtl = await redis.pttl("cc:v1:XAUUSDT:15m");
assert.ok(lateTtl > 0 && lateTtl <= 5_000, `late ttl ${lateTtl}`);
mode = "ok";
console.log("✓ a candle Binance has not published yet is retried within seconds");

// Unknown coin: 404, remembered for ten minutes (no repeat requests).
await assert.rejects(a.coin("NOPEUSDT", NOW), (e) => e.getStatus() === 404);
const before = calls.length;
await assert.rejects(b.coin("NOPEUSDT", NOW), (e) => e.getStatus() === 404);
assert.equal(calls.length, before, "unknown coin answered from the cache");
assert.ok((await redis.pttl("cc:v1:NOPEUSDT:15m")) > 9 * 60_000);
console.log("✓ an unknown coin is remembered, not re-asked");

// Binance down: 503 and nothing cached, so the next visit tries again.
mode = "down";
await assert.rejects(a.coin("ETHUSDT", NOW), (e) => e.getStatus() === 503);
assert.equal(await redis.exists(...keys("ETHUSDT")), 0);
mode = "ok";
const eth = await a.coin("ETHUSDT", NOW);
assert.equal(eth.candles["4h"].length, CARD_CANDLES["4h"]);
console.log("✓ an outage is reported and not cached");

// Without Redis (it is down), the card still loads straight from Binance.
const solo = new CandlesService(env);
solo.connect(null, fetcher);
assert.equal((await solo.coin("BTCUSDT", NOW)).candles["1h"].length, CARD_CANDLES["1h"]);
console.log("✓ works without the cache");

for (const s of ["BTCUSDT", "XAUUSDT", "NOPEUSDT", "ETHUSDT"]) await redis.del(...keys(s));
await redis.quit();
console.log("All coin-card candle checks passed");
