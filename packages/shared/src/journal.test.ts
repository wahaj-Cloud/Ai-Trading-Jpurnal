import { describe, expect, it } from "vitest";
import { analyticsQuerySchema } from "./analytics.js";
import { journalInputSchema } from "./journal.js";

describe("journalInputSchema", () => {
  it("defaults to an empty entry", () => {
    expect(journalInputSchema.parse({})).toEqual({
      setup: null,
      tags: [],
      emotions: [],
      mistakes: [],
      rating: null,
      notes: null,
      stopPrice: null,
      targetPrice: null,
      screenshotUrls: [],
    });
  });

  it.each([
    [{ rating: 6 }],
    [{ rating: 2.5 }],
    [{ emotions: ["HAPPY"] }],
    [{ mistakes: ["drop table"] }],
    [{ stopPrice: "-1" }],
    [{ stopPrice: "1e5" }],
    [{ screenshotUrls: ["http://example.com/chart.png"] }],
    [{ screenshotUrls: ["javascript:alert(1)"] }],
    [{ tags: ["<script>"] }],
    [{ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    [{ notes: "x".repeat(10_001) }],
    [{ unknown: true }],
  ])("rejects %j", (input) => {
    expect(journalInputSchema.safeParse(input).success).toBe(false);
  });

  it("accepts https screenshot links and trims prices", () => {
    const parsed = journalInputSchema.parse({
      stopPrice: " 61000.5 ",
      screenshotUrls: ["https://www.tradingview.com/x/AbC123/"],
    });
    expect(parsed.stopPrice).toBe("61000.5");
    expect(parsed.screenshotUrls).toHaveLength(1);
  });
});

describe("analyticsQuerySchema", () => {
  it("defaults to all time", () => {
    expect(analyticsQuerySchema.parse({})).toEqual({ range: "all" });
  });
  it("rejects reversed and malformed custom ranges", () => {
    expect(analyticsQuerySchema.safeParse({ from: "2026-09-02", to: "2026-09-01" }).success).toBe(
      false,
    );
    expect(analyticsQuerySchema.safeParse({ from: "01/09/2026" }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ range: "forever" }).success).toBe(false);
  });
});

describe("isoDaySchema", () => {
  it("accepts real days and rejects impossible ones", async () => {
    const { isoDaySchema } = await import("./dates.js");
    expect(isoDaySchema.safeParse("2026-02-28").success).toBe(true);
    expect(isoDaySchema.safeParse("2024-02-29").success).toBe(true);
    for (const bad of ["2026-02-31", "2026-99-99", "2026-13-01", "1999-12-31", "26-01-01"])
      expect(isoDaySchema.safeParse(bad).success).toBe(false);
  });
});
