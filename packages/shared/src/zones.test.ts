import { describe, expect, it } from "vitest";
import {
  createZoneAlertSchema,
  entryZoneOf,
  nearestCockpitZones,
  type StoredZone,
  zoneAlertHits,
  zoneAlignment,
  zoneDistPct,
  zoneKey,
} from "./zones.js";

const z = (
  side: "supply" | "demand",
  bottom: number,
  top: number,
  tests = 0,
  t = 1,
): StoredZone => ({
  side,
  bottom,
  top,
  tests,
  t,
});
const market = {
  "1h": {
    asOf: "2026-10-21T08:00:00.000Z",
    zones: [
      z("supply", 2010, 2015, 0, 10),
      z("demand", 1990, 1995, 2, 11),
      z("supply", 2040, 2050, 0, 12),
    ],
  },
  "4h": {
    asOf: "2026-10-21T08:00:00.000Z",
    zones: [z("demand", 1985, 1996, 0, 20), z("supply", 2100, 2120, 1, 21)],
  },
};

describe("zone alerts", () => {
  it("finds the watched zones the price is inside, fresh and higher timeframe first", () => {
    const hits = zoneAlertHits({ tfs: ["1h", "4h"], side: "ANY", freshOnly: false }, market, 1993);
    expect(hits.map((h) => h.key)).toEqual(["4h:demand:20", "1h:demand:11"]);
    expect(
      zoneAlertHits({ tfs: ["1h", "4h"], side: "ANY", freshOnly: true }, market, 1993).map(
        (h) => h.key,
      ),
    ).toEqual(["4h:demand:20"]);
    expect(zoneAlertHits({ tfs: ["1h"], side: "SUPPLY", freshOnly: true }, market, 1993)).toEqual(
      [],
    );
    expect(
      zoneAlertHits({ tfs: ["1h"], side: "SUPPLY", freshOnly: true }, market, 2015)[0]?.key,
    ).toBe("1h:supply:10");
    // Edges count as inside; a price outside every zone gives nothing.
    expect(
      zoneAlertHits({ tfs: ["1h"], side: "ANY", freshOnly: false }, market, 2010),
    ).toHaveLength(1);
    expect(
      zoneAlertHits({ tfs: ["1h", "4h"], side: "ANY", freshOnly: false }, market, 2000),
    ).toEqual([]);
    expect(zoneAlertHits({ tfs: ["1h"], side: "ANY", freshOnly: false }, undefined, 2000)).toEqual(
      [],
    );
  });

  it("validates the alert", () => {
    expect(createZoneAlertSchema.parse({ symbol: "xauusdt", tfs: ["4h", "1h", "4h"] })).toEqual({
      symbol: "XAUUSDT",
      tfs: ["1h", "4h"],
      side: "ANY",
      freshOnly: true,
      cooldownMin: 120,
    });
    expect(createZoneAlertSchema.safeParse({ symbol: "XAUUSDT", tfs: [] }).success).toBe(false);
    expect(createZoneAlertSchema.safeParse({ symbol: "XAUUSDT", tfs: ["15m"] }).success).toBe(
      false,
    );
    expect(zoneKey("4h", { side: "demand", t: 5 })).toBe("4h:demand:5");
  });
});

describe("cockpit ladder", () => {
  it("keeps the nearest supply above and demand below on each timeframe", () => {
    const near = nearestCockpitZones(market, 2000, 1);
    expect(near.map((x) => [x.tf, x.side, x.bottom])).toEqual([
      ["1h", "supply", 2010],
      ["1h", "demand", 1990],
      ["4h", "supply", 2100],
      ["4h", "demand", 1985],
    ]);
    expect(near[0]?.distPct).toBeCloseTo(0.5, 12);
    expect(near[1]?.distPct).toBeCloseTo(-0.25, 12);
    expect(zoneDistPct(1992, { top: 1995, bottom: 1990 })).toBe(0);
  });
});

describe("trades entered at a zone", () => {
  const records = {
    "1h": { at: new Date("2026-10-21T08:00:00Z"), zones: market["1h"].zones },
    "4h": { at: new Date("2026-10-21T04:00:00Z"), zones: market["4h"].zones },
  };
  it("lists every zone the entry price was inside", () => {
    expect(entryZoneOf(1993, records)).toEqual({
      at: "2026-10-21T08:00:00.000Z",
      zones: [
        { tf: "1h", side: "demand", fresh: false },
        { tf: "4h", side: "demand", fresh: true },
      ],
    });
    expect(entryZoneOf(2000, records)?.zones).toEqual([]);
    expect(entryZoneOf(2000, {})).toBeNull();
  });
  it("with, against, both or none", () => {
    const e = entryZoneOf(1993, records) as NonNullable<ReturnType<typeof entryZoneOf>>;
    expect(zoneAlignment("LONG", e)).toBe("with");
    expect(zoneAlignment("SHORT", e)).toBe("against");
    expect(zoneAlignment("LONG", { zones: [] })).toBe("none");
    expect(
      zoneAlignment("LONG", {
        zones: [
          { tf: "1h", side: "supply", fresh: true },
          { tf: "4h", side: "demand", fresh: true },
        ],
      }),
    ).toBe("mixed");
  });
});
