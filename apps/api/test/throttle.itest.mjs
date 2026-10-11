// Integration test: shared rate-limit storage on a real Redis (two "instances" share one budget).
import assert from "node:assert/strict";
import { RedisThrottlerStorage } from "../dist/common/redis-throttler.storage.js";
import { UserThrottlerGuard } from "../dist/common/user-throttler.guard.js";

const url = process.env.REDIS_URL ?? "";
if (!/\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Needs a local REDIS_URL");
const a = new RedisThrottlerStorage(url);
const b = new RedisThrottlerStorage(url);
const key = `itest-${Date.now()}`;
let last;
for (let i = 0; i < 3; i++) last = await a.increment(key, 60_000, 5, 30_000, "default");
for (let i = 0; i < 3; i++) last = await b.increment(key, 60_000, 5, 30_000, "default");
assert.equal(last.totalHits, 6, "both instances count into one window");
assert.equal(last.isBlocked, true, "over the limit: blocked");
assert.ok(last.timeToBlockExpire > 0 && last.timeToBlockExpire <= 30);
assert.ok(last.timeToExpire > 0 && last.timeToExpire <= 60);
const other = await a.increment(`${key}-other`, 60_000, 5, 30_000, "default");
assert.equal(other.totalHits, 1, "separate clients have separate budgets");
await a.onModuleDestroy();
await b.onModuleDestroy();
console.log("✓ rate limits are shared across API instances through Redis");
// Budgets follow the signed-in user, not the (shared) web-server IP.
const tracker = (req) => UserThrottlerGuard.prototype.getTracker.call({}, req);
assert.equal(await tracker({ ip: "10.0.0.1", user: { id: "u1" } }), "user:u1");
assert.equal(await tracker({ ip: "10.0.0.1", user: { id: "u2" } }), "user:u2");
assert.equal(await tracker({ ip: "10.0.0.1" }), "ip:10.0.0.1");
console.log("✓ limits are per user (two users behind one IP have separate budgets)");
console.log("All rate-limit integration checks passed");
