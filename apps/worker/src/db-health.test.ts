import { classifyDbError, DB_HEALTH_KEY, pendingMigrations, waitForDatabase } from "@atc/db";
import { describe, expect, it } from "vitest";
import { waitUntilDatabaseReady } from "./db-health.js";

const quiet = { info: () => undefined, warn: () => undefined };

describe("database problems in plain words", () => {
  it("recognises the usual failures", () => {
    expect(
      classifyDbError(
        new Error("Your project has exceeded the data transfer quota. Upgrade your plan"),
      ).problem,
    ).toBe("quota");
    expect(classifyDbError({ code: "P1001", message: "Can't reach database server" }).problem).toBe(
      "unreachable",
    );
    expect(classifyDbError(new Error("password authentication failed for user x")).problem).toBe(
      "auth",
    );
    expect(
      classifyDbError({
        code: "P2021",
        message: "The table `public.x` does not exist in the current database.",
      }).problem,
    ).toBe("schema");
    expect(classifyDbError(new Error("boom")).problem).toBe("other");
    // Wrapped errors (Prisma wraps the driver's) are read through `cause`.
    expect(
      classifyDbError(new Error("Invalid invocation", { cause: new Error("ECONNREFUSED") }))
        .problem,
    ).toBe("unreachable");
  });
  it("never repeats connection details", () => {
    const m = classifyDbError(
      new Error("connect to postgresql://user:secret@host failed: quota"),
    ).message;
    expect(m).not.toContain("secret");
  });
});

describe("waiting out a database that refuses connections", () => {
  it("retries with growing pauses, reports each state, then carries on", async () => {
    let tries = 0;
    const pauses: number[] = [];
    const states: Array<{ ok: boolean; problem: string | null }> = [];
    await waitForDatabase({
      probe: async () => {
        tries++;
        if (tries < 5) throw new Error("exceeded the data transfer quota");
      },
      log: quiet,
      sleep: async (ms) => {
        pauses.push(ms);
      },
      onStatus: (h) => {
        states.push({ ok: h.ok, problem: h.problem });
      },
    });
    expect(tries).toBe(5);
    expect(pauses).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(states.at(-1)).toEqual({ ok: true, problem: null });
    expect(states.slice(0, 4).every((s) => s.problem === "quota")).toBe(true);
  });
  it("caps the pause at five minutes and can give up", async () => {
    const pauses: number[] = [];
    let t = 0;
    await expect(
      waitForDatabase({
        probe: async () => {
          throw new Error("ECONNREFUSED");
        },
        log: quiet,
        sleep: async (ms) => {
          pauses.push(ms);
          t += ms;
        },
        now: () => t,
        giveUpAfterMs: 60 * 60_000,
      }),
    ).rejects.toThrow();
    expect(Math.max(...pauses)).toBe(300_000);
  });
});

describe("migrations", () => {
  it("lists the ones not applied; unknown when there is no table", async () => {
    const q = async () => [{ migration_name: "a" }, { migration_name: "b" }];
    expect(await pendingMigrations(q, ["a", "b", "c"])).toEqual(["c"]);
    expect(
      await pendingMigrations(async () => {
        throw new Error('relation "_prisma_migrations" does not exist');
      }, ["a"]),
    ).toBeNull();
  });

  it("the worker waits for the API to apply this build's migrations", async () => {
    const applied: string[] = [];
    let probes = 0;
    const db = {
      $queryRawUnsafe: async (sql: string) => {
        if (sql === "SELECT 1") {
          probes++;
          return [];
        }
        // Each check, one more migration has been applied.
        const { bundledMigrations } = await import("@atc/db");
        const all = await bundledMigrations();
        if (applied.length < all.length) applied.push(all[applied.length] as string);
        return applied
          .slice(0, Math.max(0, applied.length - 1))
          .map((m) => ({ migration_name: m }));
      },
    };
    const kv = new Map<string, string>();
    const redis = { set: async (k: string, v: string) => kv.set(k, v) };
    let waits = 0;
    await waitUntilDatabaseReady(db as never, redis as never, {
      sleep: async () => {
        waits++;
        // Fast-forward: the API finishes applying everything.
        const { bundledMigrations } = await import("@atc/db");
        if (waits >= 2) applied.push(...(await bundledMigrations()), "x");
      },
    });
    expect(probes).toBe(1);
    expect(waits).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(kv.get(DB_HEALTH_KEY) ?? "{}").problem).toBe("schema");
  });
});
