import { describe, expect, it } from "vitest";
import { fixedMinus, signedFixed, signedPct, signedUsd } from "./numbers.js";

describe("signed numbers", () => {
  it("takes the sign from the shown value", () => {
    expect(signedPct(-0.0004)).toBe("0.00%");
    expect(signedPct(0.004)).toBe("0.00%");
    expect(signedPct(0)).toBe("0.00%");
    expect(signedPct(-0.005)).toBe("−0.01%"); // rounds away from zero at the half
    expect(signedPct(1.234, 1)).toBe("+1.2%");
    expect(signedPct(-12.5, 0)).toBe("−13%");
    expect(signedFixed(-0.00004, 4)).toBe("0.0000");
    expect(signedFixed(Number.NaN, 2)).toBe("—");
  });
  it("shows a true minus without a plus", () => {
    expect(fixedMinus(-0.6, 2)).toBe("−0.60");
    expect(fixedMinus(0.857, 2)).toBe("0.86");
    expect(fixedMinus(-0.001, 2)).toBe("0.00");
  });
  it("formats dollars", () => {
    expect(signedUsd(1234.5)).toBe("+$1,234.50");
    expect(signedUsd(-12)).toBe("−$12.00");
    expect(signedUsd(-0.004)).toBe("$0.00");
  });
});
