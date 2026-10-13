import { describe, expect, it } from "vitest";
import { buildResults, looksLikeQuestion, matchMonths } from "./search-items";

const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XAUUSD"];

describe("search", () => {
  it("spots questions", () => {
    expect(looksLikeQuestion("why did I lose today")).toBe(true);
    expect(looksLikeQuestion("best session?")).toBe(true);
    expect(looksLikeQuestion("calculators")).toBe(false);
  });

  it("finds pages by name and keyword", () => {
    const r = buildResults({ query: "kelly", symbols, currentMonth: "2026-10" });
    expect(r[0]?.href).toBe("/calculators");
    expect(r.at(-1)?.group).toBe("Ask");
  });

  it("finds the trader's coins", () => {
    const r = buildResults({ query: "eth", symbols, currentMonth: "2026-10" });
    expect(r.find((i) => i.group === "Coins")?.href).toBe("/trades?symbol=ETHUSDT");
  });

  it("puts the coach first for questions", () => {
    const r = buildResults({ query: "Why did I lose today?", symbols, currentMonth: "2026-10" });
    expect(r[0]?.group).toBe("Ask");
    expect(r[0]?.href).toBe(`/coach?q=${encodeURIComponent("Why did I lose today?")}`);
  });

  it("hides admin pages from traders", () => {
    const r = buildResults({ query: "admin", symbols, currentMonth: "2026-10" });
    expect(r.some((i) => i.href === "/admin")).toBe(false);
  });

  it("reads month names and numbers, never in the future", () => {
    expect(matchMonths("sep", "2026-10").map((m) => m.key)).toEqual(["2026-09", "2025-09"]);
    expect(matchMonths("november", "2026-10").map((m) => m.key)).toEqual(["2025-11", "2024-11"]);
    expect(matchMonths("oct 2026", "2026-10")[0]?.label).toBe("October 2026");
    expect(matchMonths("2026-08", "2026-10")[0]?.key).toBe("2026-08");
    expect(matchMonths("8/2026", "2026-10")[0]?.key).toBe("2026-08");
    expect(matchMonths("2026-12", "2026-10")).toEqual([]);
    expect(matchMonths("xyz", "2026-10")).toEqual([]);
  });
});
