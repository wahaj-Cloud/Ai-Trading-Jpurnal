/**
 * Waiting out a database that refuses connections (Neon over its monthly allowance, a network
 * blip, a restart) instead of crashing. A crashed service on Railway restarts a limited number of
 * times and then stays down; a service that waits recovers by itself once the database is back.
 */

export type DbProblem = "quota" | "unreachable" | "auth" | "schema" | "other";

export interface DbHealth {
  ok: boolean;
  problem: DbProblem | null;
  /** Plain-language reason, safe to show to an admin (no connection strings). */
  message: string | null;
  /** When the current state began (ISO). */
  since: string;
  checkedAt: string;
  by: string;
}

export const DB_HEALTH_KEY = "health:db";
/** The record expires if nothing refreshes it (the service is down): absence means unknown. */
export const DB_HEALTH_TTL_S = 15 * 60;

const text = (err: unknown): string => {
  if (!err || typeof err !== "object") return String(err ?? "");
  const e = err as { message?: unknown; code?: unknown; cause?: unknown };
  const own = `${typeof e.code === "string" ? `${e.code} ` : ""}${typeof e.message === "string" ? e.message : ""}`;
  return e.cause && e.cause !== err ? `${own} ${text(e.cause)}` : own;
};

/** What kind of failure this is, from the driver's or Prisma's error. */
export function classifyDbError(err: unknown): { problem: DbProblem; message: string } {
  const t = text(err);
  if (/quota|transfer allowance|limit reached|exceeded the/i.test(t))
    return {
      problem: "quota",
      message:
        "The database host refused the connection: the plan's monthly allowance is used up. Upgrade the database plan.",
    };
  if (/password authentication|P1000|authentication failed|role .* does not exist/i.test(t))
    return {
      problem: "auth",
      message: "The database rejected the login. Check DATABASE_URL in the service's variables.",
    };
  if (
    /P2021|P2022|does not exist in the current database|relation .* does not exist|column .* does not exist/i.test(
      t,
    )
  )
    return {
      problem: "schema",
      message:
        "The database is missing a table or column: the latest migrations have not run yet (the API applies them when it deploys).",
    };
  if (
    /P1001|P1002|P1017|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|timeout|Can't reach|terminat|Connection/i.test(
      t,
    )
  )
    return {
      problem: "unreachable",
      message: "The database cannot be reached (network, or the database is restarting).",
    };
  return { problem: "other", message: "The database returned an error." };
}

export interface WaitOptions {
  /** A tiny query proving the database answers, e.g. () => db.$queryRaw`SELECT 1`. */
  probe: () => Promise<unknown>;
  log: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  };
  /** Told about every state (to publish it where admins can see it). */
  onStatus?: (h: DbHealth) => Promise<void> | void;
  by?: string;
  firstDelayMs?: number;
  maxDelayMs?: number;
  /** Gives up after this long (ms); default never. */
  giveUpAfterMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Resolves once the database answers, retrying with growing pauses (5 s, 10 s, 20 s … up to 5
 * minutes). Each try is one `SELECT 1`, so waiting costs almost no database transfer.
 */
export async function waitForDatabase(o: WaitOptions): Promise<void> {
  const sleep = o.sleep ?? wait;
  const now = o.now ?? Date.now;
  const by = o.by ?? "service";
  const started = now();
  let delay = o.firstDelayMs ?? 5_000;
  const max = o.maxDelayMs ?? 5 * 60_000;
  let since: string | null = null;
  let lastProblem: DbProblem | null = null;
  for (let attempt = 1; ; attempt++) {
    try {
      await o.probe();
      if (since) o.log.info("database is back", { attempt, downSince: since });
      await o.onStatus?.({
        ok: true,
        problem: null,
        message: null,
        since: new Date(now()).toISOString(),
        checkedAt: new Date(now()).toISOString(),
        by,
      });
      return;
    } catch (err) {
      const { problem, message } = classifyDbError(err);
      if (problem !== lastProblem) since = new Date(now()).toISOString();
      lastProblem = problem;
      o.log.warn("database unavailable, waiting", {
        attempt,
        problem,
        reason: message,
        retryInSeconds: Math.round(delay / 1000),
      });
      await o.onStatus?.({
        ok: false,
        problem,
        message,
        since: since as string,
        checkedAt: new Date(now()).toISOString(),
        by,
      });
      if (o.giveUpAfterMs !== undefined && now() - started >= o.giveUpAfterMs) throw err;
      await sleep(delay);
      delay = Math.min(max, delay * 2);
    }
  }
}

/**
 * Migrations in this build that the database has not finished applying (the API applies them
 * before it starts; a worker deployed at the same moment waits for them). Null when it cannot
 * tell (no migrations table, e.g. a database set up by hand), meaning "do not wait".
 */
export async function pendingMigrations(
  query: (sql: string) => Promise<Array<{ migration_name: string }>>,
  bundled: readonly string[],
): Promise<string[] | null> {
  let rows: Array<{ migration_name: string }>;
  try {
    rows = await query(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
    );
  } catch {
    return null;
  }
  const done = new Set(rows.map((r) => r.migration_name));
  return bundled.filter((m) => !done.has(m));
}

/** The migration folder names shipped with this build, oldest first. */
export async function bundledMigrations(): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  // dist/src/wait.js → ../../prisma/migrations
  const dir = fileURLToPath(new URL("../../prisma/migrations/", import.meta.url));
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}
