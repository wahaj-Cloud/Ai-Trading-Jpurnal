import { describe, expect, it } from "vitest";
import { safeText } from "./render.js";

describe("safeText (spreadsheet formula injection)", () => {
  it("neutralises formula starts, including padded and full-width ones", () => {
    for (const v of [
      "=1+1",
      "+cmd",
      "-2+3",
      "@SUM(A1)",
      "  =HYPERLINK()",
      "\t=x",
      "＝1+1",
      "　＠x",
    ])
      expect(safeText(v)).toBe(`'${v}`);
  });
  it("leaves ordinary text alone", () => {
    for (const v of ["BTCUSDT", "breakout retest", "a=b", ""]) expect(safeText(v)).toBe(v);
  });
});
