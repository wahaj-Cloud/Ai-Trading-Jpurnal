import {
  bundledMigrations,
  classifyDbError,
  DB_HEALTH_KEY,
  DB_HEALTH_TTL_S,
  type DbHealth,
  type PrismaClient,
  pendingMigrations,
  waitForDatabase,
} from "@atc/db";
import type { Redis } from "ioredis";
import { log } from "./logger.js";

/** Published to Redis so the admin panel can show it even while the database refuses us. */
async function publish(redis: Redis, h: DbHealth): Promise<void> {
  await redis.set(DB_HEALTH_KEY, JSON.stringify(h), "EX", DB_HEALTH_TTL_S).catch(() => undefined);
}

const probe = (db: PrismaClient) => () => db.$queryRawUnsafe("SELECT 1");

/**
 * Before the worker starts its queues: wait for the database to answer, then (up to 15 minutes)
 * for the migrations of this build to be applied (the API applies them as it deploys). Waiting
 * instead of crashing keeps Railway from giving up on the service after its restart limit.
 */
export async function waitUntilDatabaseReady(
  db: PrismaClient,
  redis: Redis,
  opts: { sleep?: (ms: number) => Promise<void>; migrationWaitMs?: number } = {},
): Promise<void> {
  await waitForDatabase({
    probe: probe(db),
    log,
    by: "worker",
    sleep: opts.sleep,
    onStatus: (h) => publish(redis, h),
  });
  const bundled = await bundledMigrations();
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts.migrationWaitMs ?? 15 * 60_000);
  for (;;) {
    const pending = await pendingMigrations((sql) => db.$queryRawUnsafe(sql), bundled).catch(
      () => null,
    );
    if (!pending || pending.length === 0) return;
    if (Date.now() >= deadline) {
      log.warn("migrations still pending; starting anyway", { pending });
      return;
    }
    log.info("waiting for the API to apply migrations", { pending });
    await publish(redis, {
      ok: false,
      problem: "schema",
      message: `Waiting for ${pending.length} database update(s) to be applied by the API.`,
      since: new Date().toISOString(),
      checkedAt: new Date().toISOString(),
      by: "worker",
    });
    await sleep(15_000);
  }
}

/**
 * Checks the database once a minute while running and publishes the result (one `SELECT 1`, a
 * few hundred bytes). Returns a stop function.
 */
export function watchDatabase(db: PrismaClient, redis: Redis, everyMs = 60_000): () => void {
  let since = new Date().toISOString();
  let lastOk = true;
  const tick = async () => {
    const at = new Date().toISOString();
    try {
      await probe(db)();
      if (!lastOk) {
        since = at;
        log.info("database is back");
      }
      lastOk = true;
      await publish(redis, {
        ok: true,
        problem: null,
        message: null,
        since,
        checkedAt: at,
        by: "worker",
      });
    } catch (err) {
      const { problem, message } = classifyDbError(err);
      if (lastOk) since = at;
      lastOk = false;
      log.warn("database check failed", { problem, reason: message });
      await publish(redis, { ok: false, problem, message, since, checkedAt: at, by: "worker" });
    }
  };
  void tick();
  const id = setInterval(() => void tick(), everyMs);
  id.unref?.();
  return () => clearInterval(id);
}
