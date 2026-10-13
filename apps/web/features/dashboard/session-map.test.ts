import { describe, expect, it } from "vitest";
import { localSegments } from "@/features/analytics/session-verdict";

describe("localSegments", () => {
  it("shifts sessions to the local clock (Karachi, UTC+5)", () => {
    expect(localSegments("ASIA", 300)).toEqual([[300, 720]]);
    expect(localSegments("LONDON", 300)).toEqual([[720, 1080]]);
  });
  it("splits a session that crosses local midnight", () => {
    expect(localSegments("NEW_YORK", 300)).toEqual([
      [1080, 1440],
      [0, 120],
    ]);
  });
  it("keeps UTC unchanged", () => {
    expect(localSegments("OFF_HOURS", 0)).toEqual([[1260, 1440]]);
  });
});
