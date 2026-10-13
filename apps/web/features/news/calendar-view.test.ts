import type { EconomicEventDto } from "@atc/shared";
import { describe, expect, it } from "vitest";
import {
  formatUntil,
  groupByDay,
  newsHref,
  nextEvent,
  parseNewsFilters,
  toggle,
} from "./calendar-view";

const ev = (id: string, startsAt: string, tentative = false): EconomicEventDto => ({
  id,
  title: id,
  currency: "USD",
  impact: "HIGH",
  startsAt,
  tentative,
  actual: null,
  forecast: null,
  previous: null,
});

describe("news filters", () => {
  it("falls back to defaults and ignores junk", () => {
    expect(parseNewsFilters({})).toEqual({
      range: "upcoming",
      impact: ["HIGH", "MEDIUM", "LOW"],
      currency: [],
      tz: "local",
    });
    expect(
      parseNewsFilters({
        range: "today",
        impact: "none,high,bogus",
        currency: "eur,xxx",
        tz: "utc",
      }),
    ).toEqual({ range: "today", impact: ["HIGH", "NONE"], currency: ["EUR"], tz: "utc" });
  });

  it("builds short links and round-trips", () => {
    const f = parseNewsFilters({});
    expect(newsHref(f, {})).toBe("/news");
    const href = newsHref(f, { range: "this-week", impact: ["HIGH"], currency: ["GBP", "USD"] });
    expect(href).toBe("/news?range=this-week&impact=HIGH&currency=USD%2CGBP");
    const back = parseNewsFilters(Object.fromEntries(new URL(href, "http://x").searchParams));
    expect(back.currency).toEqual(["USD", "GBP"]);
  });

  it("toggles and never leaves an empty list", () => {
    expect(toggle(["A", "B"], "B")).toEqual(["A"]);
    expect(toggle(["A"], "B")).toEqual(["A", "B"]);
    expect(toggle(["A"], "A", ["X"])).toEqual(["X"]);
  });
});

describe("grouping", () => {
  const now = new Date("2026-10-14T10:00:00Z");

  it("groups by the display day and names today and tomorrow", () => {
    const days = groupByDay(
      [
        ev("b", "2026-10-15T08:30:00Z"),
        ev("a", "2026-10-14T12:30:00Z"),
        ev("late", "2026-10-14T20:00:00Z"),
      ],
      "Asia/Karachi",
      now,
    );
    // 20:00 UTC is already the 15th in Karachi.
    expect(days.map((d) => [d.key, d.events.map((e) => e.id)])).toEqual([
      ["2026-10-14", ["a"]],
      ["2026-10-15", ["late", "b"]],
    ]);
    expect(days[0]?.label).toMatch(/^Today · Wednesday/);
    expect(days[1]?.label).toMatch(/^Tomorrow/);
  });

  it("finds the next timed event", () => {
    const list = [
      ev("past", "2026-10-14T09:00:00Z"),
      ev("t", "2026-10-14T11:00:00Z", true),
      ev("n", "2026-10-14T12:00:00Z"),
    ];
    expect(nextEvent(list, now)?.id).toBe("n");
    expect(nextEvent([], now)).toBeNull();
  });

  it("formats countdowns", () => {
    expect(formatUntil(30_000)).toBe("now");
    expect(formatUntil(5 * 60_000)).toBe("in 5m");
    expect(formatUntil(125 * 60_000)).toBe("in 2h 05m");
    expect(formatUntil((26 * 60 + 3) * 60_000)).toBe("in 1d 2h");
  });
});
