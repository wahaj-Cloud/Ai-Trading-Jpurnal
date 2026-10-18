import { describe, expect, it } from "vitest";
import {
  DASHBOARD_WIDGETS,
  type DashboardSlot,
  defaultLayout,
  normalizeLayout,
  slotSize,
} from "./dashboard.js";

describe("dashboard layout", () => {
  it("uses the default for missing or invalid data", () => {
    expect(normalizeLayout(null)).toEqual(defaultLayout());
    expect(normalizeLayout("nope")).toEqual(defaultLayout());
    expect(normalizeLayout([{ id: "kpis" }])).toEqual(defaultLayout());
  });

  it("keeps the saved order and visibility, then adds widgets it has never seen", () => {
    const out = normalizeLayout([
      { id: "equity", hidden: false },
      { id: "kpis", hidden: true },
    ]);
    const ids = out.map((s) => s.id);
    expect(ids.indexOf("equity")).toBeLessThan(ids.indexOf("kpis"));
    expect(out[0]).toEqual({ id: "equity", hidden: false });
    expect(out).toHaveLength(DASHBOARD_WIDGETS.length);
    // Widgets never seen before start in their default state.
    expect(
      out
        .filter((s) => s.hidden)
        .map((s) => s.id)
        .sort(),
    ).toEqual(
      [
        "kpis",
        ...DASHBOARD_WIDGETS.filter((w) => "defaultHidden" in w && w.defaultHidden).map(
          (w) => w.id,
        ),
      ].sort(),
    );
  });

  it("places a new widget next to its neighbour in the default order", () => {
    const saved = DASHBOARD_WIDGETS.filter((w) => w.id !== "economic-calendar")
      .map((w) => ({ id: w.id, hidden: false }))
      .reverse();
    const out = normalizeLayout(saved).map((s) => s.id);
    expect(out.indexOf("economic-calendar")).toBe(out.indexOf("daily-pnl") + 1);
    expect(out).toHaveLength(DASHBOARD_WIDGETS.length);
  });

  it("keeps a chosen width, drops one equal to the default, and refuses unknown widths", () => {
    const out = normalizeLayout([
      { id: "equity", hidden: false, size: "full" },
      { id: "coach", hidden: false, size: "narrow" },
    ]);
    expect(out[0]).toEqual({ id: "equity", hidden: false, size: "full" });
    expect(out[1]).toEqual({ id: "coach", hidden: false });
    expect(slotSize(out[0] as DashboardSlot)).toBe("full");
    expect(slotSize(out[1] as DashboardSlot)).toBe("narrow");
    expect(normalizeLayout([{ id: "equity", hidden: false, size: "huge" }])).toEqual(
      defaultLayout(),
    );
  });

  it("starts new dashboards focused: analytics repeats are hidden, trade check is shown", () => {
    const d = defaultLayout();
    expect(d[0]?.id).toBe("kpis");
    expect(d.find((s) => s.id === "hourly")?.hidden).toBe(true);
    expect(d.find((s) => s.id === "trade-check")?.hidden).toBe(false);
    expect(new Set(d.map((s) => s.id)).size).toBe(DASHBOARD_WIDGETS.length);
  });

  it("drops unknown and duplicate ids", () => {
    const out = normalizeLayout([
      { id: "retired-widget", hidden: false },
      { id: "goals", hidden: true },
      { id: "goals", hidden: false },
    ]);
    expect(out[0]).toEqual({ id: "goals", hidden: true });
    expect(out.filter((s) => s.id === "goals")).toHaveLength(1);
    expect(out.some((s) => (s.id as string) === "retired-widget")).toBe(false);
  });
});
