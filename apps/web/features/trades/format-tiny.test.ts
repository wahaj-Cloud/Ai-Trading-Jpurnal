import { describe, expect, it } from "vitest";
import { formatSignedTiny } from "./format";

describe("tiny signed amounts", () => {
  it("fits five characters", () => {
    expect(formatSignedTiny("473312.4")).toBe("+473K");
    expect(formatSignedTiny("-1234567")).toBe("−1.2M");
    expect(formatSignedTiny("-2100")).toBe("−2.1K");
    expect(formatSignedTiny("85.4")).toBe("+85");
    expect(formatSignedTiny("0")).toBe("0");
  });
});
