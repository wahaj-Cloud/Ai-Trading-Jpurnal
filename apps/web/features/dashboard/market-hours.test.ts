import { describe, expect, it } from "vitest";
import { formatCountdown, MARKETS, marketStatus, wallClock } from "./market-hours";

const london = MARKETS.find((m) => m.id === "LONDON")!;
const ny = MARKETS.find((m) => m.id === "NEW_YORK")!;

describe("market hours", () => {
  it("reads the wall clock in another timezone", () => {
    // 2026-10-13 is a Tuesday; 14:19 UTC is 15:19 in London (BST).
    expect(wallClock(new Date("2026-10-13T14:19:00Z"), "Europe/London")).toEqual({
      weekday: 2,
      minutes: 15 * 60 + 19,
    });
  });

  it("knows London is open and when it closes", () => {
    const s = marketStatus(london, new Date("2026-10-13T14:19:00Z"));
    expect(s.open).toBe(true);
    expect(s.minutesToChange).toBe(17 * 60 - (15 * 60 + 19));
    expect(s.localTime).toBe("15:19");
  });

  it("counts to Monday's open over a weekend", () => {
    // Saturday 2026-10-17 12:00 in New York (EDT, UTC-4).
    const s = marketStatus(ny, new Date("2026-10-17T16:00:00Z"));
    expect(s.open).toBe(false);
    expect(s.minutesToChange).toBe(2 * 1440 - 12 * 60 + 8 * 60);
  });

  it("formats countdowns", () => {
    expect(formatCountdown(401)).toBe("6h 41m");
    expect(formatCountdown(45)).toBe("45m");
    expect(formatCountdown(3000)).toBe("2d 2h");
  });
});
