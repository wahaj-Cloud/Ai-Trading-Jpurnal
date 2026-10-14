import { describe, expect, it } from "vitest";
import { rangeFor, zonedMidnight, zoneOffsetMinutes } from "./ranges";

// Wednesday 2026-10-14 00:42 in Karachi (UTC+5) = Tuesday 19:42 UTC.
const now = new Date("2026-10-13T19:42:00Z");
const iso = (r: { from: Date; to: Date }) => [r.from.toISOString(), r.to.toISOString()];

describe("calendar ranges", () => {
  it("knows zone offsets, including DST", () => {
    expect(zoneOffsetMinutes(now, "Asia/Karachi")).toBe(300);
    expect(zoneOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "America/New_York")).toBe(-240);
    expect(zoneOffsetMinutes(new Date("2026-12-01T12:00:00Z"), "America/New_York")).toBe(-300);
    expect(zonedMidnight(2026, 11, 1, "America/New_York").toISOString()).toBe(
      "2026-11-01T04:00:00.000Z",
    );
  });

  it("uses the trader's own day", () => {
    expect(iso(rangeFor("today", "Asia/Karachi", now))).toEqual([
      "2026-10-13T19:00:00.000Z",
      "2026-10-14T19:00:00.000Z",
    ]);
    expect(iso(rangeFor("today", "UTC", now))).toEqual([
      "2026-10-13T00:00:00.000Z",
      "2026-10-14T00:00:00.000Z",
    ]);
  });

  it("runs weeks Monday to Sunday and months by calendar", () => {
    expect(iso(rangeFor("this-week", "Asia/Karachi", now))).toEqual([
      "2026-10-11T19:00:00.000Z",
      "2026-10-18T19:00:00.000Z",
    ]);
    expect(rangeFor("previous-week", "UTC", now).from.toISOString()).toBe(
      "2026-10-05T00:00:00.000Z",
    );
    expect(iso(rangeFor("previous-month", "UTC", now))).toEqual([
      "2026-09-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    ]);
  });

  it("looks a week ahead for upcoming, keeping the last hour", () => {
    const r = rangeFor("upcoming", "UTC", now);
    expect(now.getTime() - r.from.getTime()).toBe(3_600_000);
    expect(r.to.getTime() - now.getTime()).toBe(7 * 86_400_000);
  });
});
