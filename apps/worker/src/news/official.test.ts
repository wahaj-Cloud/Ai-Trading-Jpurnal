import { describe, expect, it } from "vitest";
import { expectedPeriod, formatFigure, parseBls, specFor } from "./official.js";

// Shape of a BLS API v2 answer with calculations=true (newest observation first).
const sample = {
  status: "REQUEST_SUCCEEDED",
  Results: {
    series: [
      {
        seriesID: "CUSR0000SA0",
        data: [
          {
            year: "2026",
            period: "M09",
            value: "325.1",
            calculations: { pct_changes: { "1": "0.4", "12": "3.0" }, net_changes: { "1": "1.2" } },
          },
          {
            year: "2026",
            period: "M08",
            value: "323.9",
            calculations: { pct_changes: { "1": "0.3" } },
          },
        ],
      },
      {
        seriesID: "CES0000000001",
        data: [
          {
            year: "2026",
            period: "M09",
            value: "160450",
            calculations: { net_changes: { "1": "254" }, pct_changes: { "1": "0.2" } },
          },
        ],
      },
      { seriesID: "LNS14000000", data: [{ year: "2026", period: "M09", value: "4.1" }] },
      {
        seriesID: "CUUR0000SA0",
        data: [
          {
            year: "2026",
            period: "M09",
            value: "324.8",
            calculations: { pct_changes: { "12": "2.9" } },
          },
        ],
      },
    ],
  },
};

describe("official (BLS) releases", () => {
  it("knows which calendar titles it can answer", () => {
    expect(specFor("CPI m/m")?.series).toBe("CUSR0000SA0");
    expect(specFor("Core CPI y/y")?.series).toBe("CUUR0000SA0L1E");
    expect(specFor("Non-Farm Employment Change")?.field).toBe("net1K");
    expect(specFor("Retail Sales m/m")).toBeUndefined();
  });

  it("reads the newest month with its calculations", () => {
    const m = parseBls(sample);
    expect(m.get("CUSR0000SA0")).toMatchObject({ period: "2026-09", pct1: "0.4" });
  });

  it("formats figures the way calendars print them", () => {
    const m = parseBls(sample);
    const at = (id: string) => {
      const o = m.get(id);
      if (!o) throw new Error(id);
      return o;
    };
    expect(formatFigure("pct1", at("CUSR0000SA0"))).toBe("0.4%");
    expect(formatFigure("pct12", at("CUUR0000SA0"))).toBe("2.9%");
    expect(formatFigure("net1K", at("CES0000000001"))).toBe("254K");
    expect(formatFigure("valuePct", at("LNS14000000"))).toBe("4.1%");
    expect(formatFigure("pct1", at("LNS14000000"))).toBeNull();
  });

  it("expects last month's data on release day", () => {
    expect(expectedPeriod(new Date("2026-10-14T12:30:00Z"))).toBe("2026-09");
    expect(expectedPeriod(new Date("2027-01-09T13:30:00Z"))).toBe("2026-12");
  });
});
