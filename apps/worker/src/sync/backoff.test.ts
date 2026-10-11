import { describe, expect, it } from "vitest";
import { retryDelayMs } from "./sync-account.js";

describe("retryDelayMs", () => {
  it("doubles from 5 minutes and caps at 6 hours", () => {
    const minutes = [1, 2, 3, 4, 5, 6, 7, 8, 50].map((n) => retryDelayMs(n) / 60_000);
    expect(minutes).toEqual([5, 10, 20, 40, 80, 160, 320, 360, 360]);
  });
});
