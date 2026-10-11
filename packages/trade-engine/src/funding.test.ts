import { describe, expect, it } from "vitest";
import { dec } from "./decimal.js";
import { fromExchangeRecord } from "./exchange-records.js";
import { attributeFunding, withFunding } from "./funding.js";
import type { DerivedPosition } from "./types.js";

const at = (h: number) => new Date(Date.UTC(2026, 8, 1) + h * 3_600_000);

function position(
  key: string,
  opened: number,
  closed: number | null,
  qty = "1",
  symbol = "BTCUSDT",
): DerivedPosition {
  return {
    sourceKey: key,
    symbol,
    direction: "LONG",
    status: closed === null ? "OPEN" : "CLOSED",
    openedAt: at(opened),
    closedAt: closed === null ? null : at(closed),
    entryPrice: "100",
    exitPrice: null,
    quantity: qty,
    leverage: null,
    grossPnl: "10",
    fees: "1",
    funding: null,
    netPnl: "9",
    incompleteHistory: false,
  };
}

describe("attributeFunding", () => {
  it("assigns events to the position open at that instant, bounds inclusive", () => {
    const { bySourceKey, unattributed } = attributeFunding(
      [position("a", 0, 8), position("b", 9, null)],
      [
        { id: "1", symbol: "BTCUSDT", amount: "-0.5", occurredAt: at(8) },
        { id: "2", symbol: "BTCUSDT", amount: "0.2", occurredAt: at(16) },
        { id: "3", symbol: "BTCUSDT", amount: "-9", occurredAt: at(8.5) },
        { id: "4", symbol: "ETHUSDT", amount: "-1", occurredAt: at(4) },
      ],
    );
    expect(bySourceKey.get("a")?.toString()).toBe("-0.5");
    expect(bySourceKey.get("b")?.toString()).toBe("0.2");
    expect(unattributed.map((e) => e.id)).toEqual(["3", "4"]);
  });

  it("splits between overlapping positions by size", () => {
    const { bySourceKey } = attributeFunding(
      [position("long", 0, null, "3"), position("short", 0, null, "1")],
      [{ id: "1", symbol: "BTCUSDT", amount: "-4", occurredAt: at(8) }],
    );
    expect(bySourceKey.get("long")?.toString()).toBe("-3");
    expect(bySourceKey.get("short")?.toString()).toBe("-1");
  });

  it("recomputes net PnL as gross - fees + funding", () => {
    expect(withFunding(position("a", 0, 8), dec("-0.5"))).toMatchObject({
      funding: "-0.5",
      netPnl: "8.5",
    });
  });
});

describe("fromExchangeRecord", () => {
  const base = {
    externalId: "390281084",
    symbol: "RVNUSDT",
    direction: "LONG" as const,
    closed: true,
    openedAt: at(0),
    closedAt: at(1),
    entryPrice: "0.03491",
    exitPrice: "0.03494",
    quantity: "114.1",
    leverage: "50",
    funding: "0",
  };

  it("keeps the exchange's figures and derives the missing net", () => {
    // MEXC sample: closeProfitLoss 0.3423, fee 0.1593977 -> realised 0.1829023
    const p = fromExchangeRecord({ ...base, grossPnl: "0.3423", fees: "0.1593977", netPnl: null });
    expect(p).toMatchObject({ sourceKey: "X:390281084", status: "CLOSED", netPnl: "0.1829023" });
  });

  it("derives gross from net when only net is reported", () => {
    const p = fromExchangeRecord({
      ...base,
      grossPnl: null,
      fees: "1",
      funding: "-0.5",
      netPnl: "8.5",
    });
    expect(p.grossPnl).toBe("10");
  });

  it("leaves unknowns unknown rather than guessing", () => {
    const p = fromExchangeRecord({ ...base, grossPnl: null, fees: null, netPnl: "5" });
    expect(p).toMatchObject({ grossPnl: null, fees: null, netPnl: "5" });
  });
});
