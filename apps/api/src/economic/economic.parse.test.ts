import { describe, expect, it } from "vitest";
import { parseForexFactory } from "./economic.parse.js";

const feed = [
  {
    title: "CPI y/y",
    country: "USD",
    date: "2026-10-14T08:30:00-04:00",
    impact: "High",
    forecast: "3.6%",
    previous: "3.4%",
  },
  {
    title: "BOE Gov Bailey Speaks",
    country: "GBP",
    date: "2026-10-14T05:30:00-04:00",
    impact: "Medium",
    forecast: "",
    previous: "",
  },
  { title: "Bank Holiday", country: "JPY", date: "2026-10-12T00:00:00-04:00", impact: "Holiday" },
  { title: "", country: "USD", date: "nope", impact: "High" },
];

describe("ForexFactory feed", () => {
  it("maps fields, impact and UTC time", () => {
    const events = parseForexFactory(feed);
    expect(events).toHaveLength(3);
    const cpi = events[0];
    expect(cpi?.currency).toBe("USD");
    expect(cpi?.impact).toBe("HIGH");
    expect(cpi?.startsAt.toISOString()).toBe("2026-10-14T12:30:00.000Z");
    expect(cpi?.forecast).toBe("3.6%");
    expect(events[1]?.impact).toBe("MEDIUM");
    expect(events[1]?.forecast).toBeNull();
    expect(events[2]).toMatchObject({ impact: "NONE", tentative: true });
  });

  it("gives the same event the same id every hour", () => {
    expect(parseForexFactory(feed)[0]?.id).toBe(parseForexFactory(feed)[0]?.id);
  });

  it("refuses non-list or empty responses", () => {
    expect(() => parseForexFactory("<html>Request denied</html>")).toThrow();
    expect(() => parseForexFactory([])).toThrow();
    expect(() => parseForexFactory([{ nope: 1 }])).toThrow();
  });
});
