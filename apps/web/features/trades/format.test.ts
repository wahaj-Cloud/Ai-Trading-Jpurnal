import { describe, expect, it } from "vitest";
import { formatDuration, formatNumber, formatPnl, pnlTone } from "./format";

describe("trade formatting", () => {
  it("formats PnL with sign and a true minus", () => {
    expect(formatPnl("297.8")).toBe("+$297.80");
    expect(formatPnl("-34.725")).toBe("−$34.73");
    expect(formatPnl("0")).toBe("$0.00");
    expect(formatPnl(null)).toBe("—");
  });
  it("shows each currency's own symbol, and none for coins", () => {
    expect(formatPnl("297.8", "USDT")).toBe("+$297.80");
    expect(formatPnl("-1234.5", "PKR")).toBe("−Rs\u00a01,234.50");
    expect(formatPnl("35", "CNY")).toBe("+¥35.00");
    expect(formatPnl("35", "EUR")).toBe("+€35.00");
    expect(formatPnl("0.0034", "BTC")).toBe("+0.0034");
  });
  it("keeps market precision without trailing zeros", () => {
    expect(formatNumber("0.03491000")).toBe("0.03491");
    expect(formatNumber("60500")).toBe("60,500");
  });
  it("describes holding time compactly", () => {
    expect([formatDuration(45), formatDuration(3_900), formatDuration(18 * 86_400)]).toEqual([
      "45s",
      "1h 5m",
      "18d 0h",
    ]);
  });
  it("classifies results for colour", () => {
    expect([pnlTone("1"), pnlTone("-1"), pnlTone("0")]).toEqual(["profit", "loss", "flat"]);
  });
});

describe("analytics formatting", () => {
  it("compact signed amounts for chart labels", async () => {
    const { formatPnlCompact, formatPercent, formatR, formatRatio } = await import("./format");
    expect(formatPnlCompact("1250")).toBe("+$1.3K");
    expect(formatPnlCompact(-350)).toBe("−$350.00");
    expect(formatPnlCompact("150032", "PKR")).toBe("+Rs\u00a0150K");
    expect(formatPercent(0.5372)).toBe("53.7%");
    expect(formatPercent(null)).toBe("—");
    expect(formatRatio(1.8571)).toBe("1.86");
    expect([formatR(2), formatR(-1.5), formatR(0)]).toEqual(["+2.0R", "−1.5R", "0.0R"]);
  });
});
