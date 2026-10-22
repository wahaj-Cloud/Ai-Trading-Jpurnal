import type { PrismaClient } from "../generated/prisma/client.js";

/**
 * Market snapshots (scan results, order-flow windows, zones, gauges) are large JSON rows that many
 * jobs and pages read far more often than they change. Every read is billed as database transfer,
 * so readers go through this cache: it asks Postgres only for the row's version (`xmin`, a few
 * bytes, changed by every write) and downloads the data again only when it changed.
 *
 * Cached values are frozen and shared: never modify them (copy first).
 */

/**
 * Optional fast copy of every snapshot written through `writeSnapshot` (Redis on the same private
 * network, so reading it is free). Readers ask the mirror first and fall back to Postgres.
 */
export interface SnapshotMirror {
  put(key: string, ver: string, payload: string): Promise<void>;
  /** Versions of the keys (null where the mirror has none). */
  versions(keys: readonly string[]): Promise<Array<string | null>>;
  get(key: string): Promise<string | null>;
}
let mirror: SnapshotMirror | null = null;
export function setSnapshotMirror(m: SnapshotMirror | null): void {
  mirror = m;
}

/** A Redis mirror (any ioredis-like client). Copies expire after 30 minutes. */
export function redisSnapshotMirror(redis: {
  set(k: string, v: string, mode: "EX", s: number): Promise<unknown>;
  mget(...k: string[]): Promise<Array<string | null>>;
  get(k: string): Promise<string | null>;
}): SnapshotMirror {
  const TTL = 1800;
  return {
    async put(key, ver, payload) {
      // Data first, version last: a reader never sees a new version with old data.
      await redis.set(`snap:d:${key}`, payload, "EX", TTL);
      await redis.set(`snap:v:${key}`, ver, "EX", TTL);
    },
    versions: (keys) =>
      keys.length ? redis.mget(...keys.map((k) => `snap:v:${k}`)) : Promise.resolve([]),
    get: (key) => redis.get(`snap:d:${key}`),
  };
}

export interface CachedSnapshot<T> {
  data: T;
  updatedAt: Date;
}

interface Entry {
  ver: string;
  data: unknown;
  updatedAt: Date;
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as Record<string, unknown>)) deepFreeze(x);
  }
  return v;
}

export class SnapshotCache {
  private readonly entries = new Map<string, Entry>();
  /** Reads served from memory, downloaded from Postgres, and loaded from the mirror. */
  readonly stats = { hits: 0, misses: 0, mirrored: 0 };

  constructor(private readonly db: Pick<PrismaClient, "$queryRaw">) {}

  /** Stores what this process just wrote, so its own readers never download it again. */
  prime(key: string, ver: string, data: unknown, updatedAt: Date): void {
    this.entries.set(key, { ver, data: deepFreeze(data), updatedAt });
  }

  async get<T>(key: string): Promise<CachedSnapshot<T> | null> {
    const [one] = await this.getMany<T>([key]);
    return one ?? null;
  }

  /** The snapshots that exist among `keys` (in the order asked). */
  async getMany<T>(keys: readonly string[]): Promise<Array<CachedSnapshot<T> & { key: string }>> {
    if (keys.length === 0) return [];
    const fromMirror = await this.fromMirror(keys);
    const rest = keys.filter((k) => !fromMirror.has(k));
    if (rest.length) await this.fromDb(rest);
    const out: Array<CachedSnapshot<T> & { key: string }> = [];
    for (const k of keys) {
      const e = this.entries.get(k);
      if (e && (fromMirror.has(k) || this.present.has(k)))
        out.push({ key: k, data: e.data as T, updatedAt: e.updatedAt });
    }
    return out;
  }

  /** Keys the mirror has (loaded into the cache when their version changed). */
  private async fromMirror(keys: readonly string[]): Promise<Set<string>> {
    const got = new Set<string>();
    if (!mirror) return got;
    try {
      const vers = await mirror.versions(keys);
      for (const [i, k] of keys.entries()) {
        const ver = vers[i];
        if (!ver) continue;
        if (this.entries.get(k)?.ver === ver) {
          this.stats.hits++;
          got.add(k);
          continue;
        }
        const raw = await mirror.get(k);
        if (!raw) continue;
        const p = JSON.parse(raw) as { ver: string; updatedAt: string; data: unknown };
        if (p.ver !== ver) continue; // being rewritten: read from Postgres instead
        this.entries.set(k, { ver, data: deepFreeze(p.data), updatedAt: new Date(p.updatedAt) });
        this.stats.mirrored++;
        got.add(k);
      }
    } catch {
      // Mirror unavailable: Postgres answers.
    }
    return got;
  }

  /** Keys found in Postgres at the last check. */
  private readonly present = new Set<string>();

  private async fromDb(keys: readonly string[]): Promise<void> {
    const vers = await this.db.$queryRaw<Array<{ key: string; ver: string }>>`
      SELECT key, xmin::text AS ver FROM market_snapshots WHERE key = ANY(${[...keys]}::text[])`;
    const current = new Map(vers.map((v) => [v.key, v.ver]));
    for (const k of keys) {
      if (current.has(k)) this.present.add(k);
      else {
        this.present.delete(k);
        this.entries.delete(k);
      }
    }
    const stale = keys.filter((k) => current.has(k) && this.entries.get(k)?.ver !== current.get(k));
    if (stale.length) {
      this.stats.misses += stale.length;
      const rows = await this.db.$queryRaw<
        Array<{ key: string; ver: string; data: unknown; updatedAt: Date }>
      >`
        SELECT key, xmin::text AS ver, data, updated_at AS "updatedAt"
          FROM market_snapshots WHERE key = ANY(${stale}::text[])`;
      for (const r of rows)
        this.entries.set(r.key, { ver: r.ver, data: deepFreeze(r.data), updatedAt: r.updatedAt });
    }
    this.stats.hits += keys.length - stale.length;
  }
}

/**
 * Writes a snapshot without sending it back (Prisma's upsert returns the whole row, doubling the
 * transfer of every write), and keeps it in this process's cache so local readers need not
 * download it.
 */
export async function writeSnapshot(
  db: Pick<PrismaClient, "$queryRaw">,
  key: string,
  data: unknown,
  updatedAt: Date = new Date(),
  /** Whose cache to keep it in (the client outside a transaction, when writing inside one). */
  cacheFor: Pick<PrismaClient, "$queryRaw"> = db,
): Promise<void> {
  const json = JSON.stringify(data);
  const rows = await db.$queryRaw<Array<{ ver: string }>>`
    INSERT INTO market_snapshots (key, data, updated_at) VALUES (${key}, ${json}::jsonb, ${updatedAt})
    ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
    RETURNING xmin::text AS ver`;
  const ver = rows[0]?.ver;
  if (!ver) return;
  // A copy: the caller may keep changing its own object.
  snapshotsOf(cacheFor).prime(key, ver, JSON.parse(json), updatedAt);
  await mirror
    ?.put(
      key,
      ver,
      `{"ver":${JSON.stringify(ver)},"updatedAt":"${updatedAt.toISOString()}","data":${json}}`,
    )
    .catch(() => undefined);
}

const caches = new WeakMap<object, SnapshotCache>();

/** The process-wide snapshot cache for a database client. */
export function snapshotsOf(db: Pick<PrismaClient, "$queryRaw">): SnapshotCache {
  let c = caches.get(db);
  if (!c) {
    c = new SnapshotCache(db);
    caches.set(db, c);
  }
  return c;
}
