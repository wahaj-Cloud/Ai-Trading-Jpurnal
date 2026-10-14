import { describe, expect, it } from "vitest";
import { matchRelease, normalizeTitle, parseProviderMessage, titleScore } from "./match.js";

const at = (iso: string) => new Date(iso);
const rows = [
  { id: "cpi-yy", title: "CPI y/y", currency: "USD", startsAt: at("2026-10-14T12:30:00Z") },
  { id: "cpi-mm", title: "CPI m/m", currency: "USD", startsAt: at("2026-10-14T12:30:00Z") },
  { id: "core-mm", title: "Core CPI m/m", currency: "USD", startsAt: at("2026-10-14T12:30:00Z") },
  {
    id: "claims",
    title: "Unemployment Claims",
    currency: "USD",
    startsAt: at("2026-10-14T12:30:00Z"),
  },
  {
    id: "nfp",
    title: "Non-Farm Employment Change",
    currency: "USD",
    startsAt: at("2026-10-14T12:30:00Z"),
  },
  { id: "eur-cpi", title: "CPI y/y", currency: "EUR", startsAt: at("2026-10-14T09:00:00Z") },
];

const msg = (event: string, extra: Record<string, unknown> = {}) => ({
  topic: "calendar",
  event,
  country: "United States",
  date: "2026-10-14T12:30:00",
  actual: "3.1%",
  forecast: "2.9%",
  previous: "2.9%",
  importance: "3",
  calendarId: "123",
  ...extra,
});

describe("provider messages", () => {
  it("parses a release and ignores empty or foreign ones", () => {
    const r = parseProviderMessage(msg("Inflation Rate YoY"));
    expect(r).toMatchObject({
      title: "Inflation Rate YoY",
      currency: "USD",
      actual: "3.1%",
      importance: 3,
    });
    expect(r?.startsAt.toISOString()).toBe("2026-10-14T12:30:00.000Z");
    expect(parseProviderMessage(msg("X", { actual: "null" }))).toBeNull();
    expect(parseProviderMessage(msg("X", { country: "Narnia" }))).toBeNull();
    expect(parseProviderMessage({ topic: "keepalive" })).toBeNull();
    expect(
      parseProviderMessage(msg("X", { forecast: undefined, "forecast ": "1%" }))?.forecast,
    ).toBe("1%");
  });
});

describe("matching to the calendar", () => {
  const find = (event: string, extra = {}) => {
    const r = parseProviderMessage(msg(event, extra));
    if (!r) throw new Error("no release");
    return matchRelease(r, rows)?.id ?? null;
  };
  it("maps provider names onto calendar names", () => {
    expect(normalizeTitle("Core Inflation Rate MoM")).toBe("core cpi m/m");
    expect(find("Inflation Rate YoY")).toBe("cpi-yy");
    expect(find("Inflation Rate MoM")).toBe("cpi-mm");
    expect(find("Core Inflation Rate MoM")).toBe("core-mm");
    expect(find("Initial Jobless Claims")).toBe("claims");
    expect(find("Non Farm Payrolls")).toBe("nfp");
  });
  it("never mixes periods, currencies or far-apart times", () => {
    expect(titleScore("CPI y/y", "CPI m/m")).toBe(0);
    expect(find("Inflation Rate YoY", { country: "Euro Area" })).toBeNull();
    expect(find("Inflation Rate YoY", { date: "2026-10-14T15:30:00" })).toBeNull();
    expect(find("Building Permits")).toBeNull();
  });
});
