import type { PrismaClient } from "@atc/db";
import { RATINGS_KEY, type RatingsSnapshot, type ScalpSnapshot } from "@atc/shared";
import { describe, expect, it } from "vitest";
import { fakeSnapshotSql } from "../testing/fake-snapshots.js";
import { dueTimeframes, runRatings } from "./ratings.js";

const NOW = Date.UTC(2026, 9, 20, 10, 15, 20); // minute 15: every timeframe is due

function fakeFetch(calls: string[]) {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const symbol = url.searchParams.get("symbol") ?? "";
    const interval = url.searchParams.get("interval") ?? "";
    calls.push(`${symbol} ${interval}`);
    if (symbol === "BADUSDT") return Response.json({ msg: "down" }, { status: 503 });
    const n = Number(url.searchParams.get("limit"));
    const up = symbol !== "DNUSDT";
    const rows = Array.from({ length: n }, (_, i) => {
      const c = 100 * (up ? 1.002 ** i : 0.998 ** i);
      return [
        i * 60_000,
        String(c),
        String(c * 1.001),
        String(c * 0.999),
        String(c),
        "10",
        i * 60_000 + 59_999,
        "0",
        1,
        "0",
        "0",
        "0",
      ];
    });
    return Response.json(rows);
  }) as typeof fetch;
}
function fakeDb(initial?: RatingsSnapshot) {
  const store = new Map<string, unknown>();
  if (initial) store.set(RATINGS_KEY, initial);
  const db = { ...fakeSnapshotSql(store) } as unknown as PrismaClient;
  return { db, get: () => store.get(RATINGS_KEY) as RatingsSnapshot };
}
const scalp = (symbols: Array<[string, number]>) =>
  ({ coins: symbols.map(([symbol, rank]) => ({ symbol, rank })) }) as unknown as ScalpSnapshot;

describe("dueTimeframes", () => {
  it("refreshes 5m/15m every minute, up to 2H every 5, longer every 15", () => {
    const some = { X: {} } as RatingsSnapshot;
    expect(dueTimeframes(7, some)).toEqual(["5m", "15m"]);
    expect(dueTimeframes(10, some)).toEqual(["5m", "15m", "30m", "1h", "2h"]);
    expect(dueTimeframes(30, some)).toHaveLength(9);
  });
});

describe("runRatings", () => {
  it("rates the top 20 plus gold and silver on every timeframe, keeping failures out", async () => {
    const calls: string[] = [];
    const { db, get } = fakeDb();
    const res = await runRatings(
      { db, config: { binance: { fetch: fakeFetch(calls) } }, now: () => NOW },
      scalp([
        ["UPUSDT", 1],
        ["DNUSDT", 2],
        ["BADUSDT", 3],
        ["FARUSDT", 40], // outside the top 20
        ["XAUUSDT", 55], // gold: always
      ]),
    );
    expect(res).toEqual({ symbols: 4, tfs: 27, failed: 9 });
    expect(calls.some((c) => c.startsWith("FARUSDT"))).toBe(false);
    expect(calls).toContain("XAUUSDT 1M");
    const s = get();
    expect(s.UPUSDT?.["1h"]?.movingAverages.level).toBe("strong_up");
    expect(s.DNUSDT?.["4h"]?.movingAverages.level).toBe("strong_down");
    expect(s.BADUSDT).toEqual({});
  });

  it("refreshes only what is due and keeps the rest", async () => {
    const calls: string[] = [];
    const first = fakeDb();
    await runRatings(
      { db: first.db, config: { binance: { fetch: fakeFetch([]) } }, now: () => NOW },
      scalp([["UPUSDT", 1]]),
    );
    const { db, get } = fakeDb(first.get());
    const later = NOW + 2 * 60_000; // minute 17
    await runRatings(
      { db, config: { binance: { fetch: fakeFetch(calls) } }, now: () => later },
      scalp([["UPUSDT", 1]]),
    );
    expect(calls).toEqual(["UPUSDT 5m", "UPUSDT 15m"]);
    expect(get().UPUSDT?.["1d"]?.computedAt).toBe(new Date(NOW).toISOString());
    expect(get().UPUSDT?.["5m"]?.computedAt).toBe(new Date(later).toISOString());
  });
});
