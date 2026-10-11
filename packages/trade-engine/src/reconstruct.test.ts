import { describe, expect, it } from "vitest";
import { reconstructPositions } from "./reconstruct.js";
import type { EngineFill, PositionSide, Side } from "./types.js";

let seq = 0;
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);

function fill(
  side: Side,
  qty: string,
  price: string,
  opts: {
    ps?: PositionSide;
    fee?: string;
    pnl?: string | null;
    t?: number;
    id?: string;
    symbol?: string;
  } = {},
): EngineFill {
  seq += 1;
  return {
    id: opts.id ?? String(seq),
    symbol: opts.symbol ?? "BTCUSDT",
    side,
    positionSide: opts.ps ?? "BOTH",
    price,
    qty,
    fee: opts.fee ?? "0",
    realizedPnl: opts.pnl === undefined ? null : opts.pnl,
    executedAt: new Date(opts.t ?? T0 + seq * 60_000),
  };
}

describe("reconstructPositions: one-way mode", () => {
  it("builds a simple long round trip with fees", () => {
    const [p, ...rest] = reconstructPositions([
      fill("BUY", "1", "100", { fee: "0.1" }),
      fill("SELL", "1", "110", { fee: "0.1" }),
    ]);
    expect(rest).toHaveLength(0);
    expect(p).toMatchObject({
      direction: "LONG",
      status: "CLOSED",
      entryPrice: "100",
      exitPrice: "110",
      quantity: "1",
      grossPnl: "10",
      fees: "0.2",
      netPnl: "9.8",
      incompleteHistory: false,
      openQuantity: "0",
    });
  });

  it("uses average cost when scaling in and out", () => {
    // Entries 1@100 + 1@110 -> avg 105. Exits 0.5@120 (+7.5) and 1.5@100 (-7.5).
    const [p] = reconstructPositions([
      fill("BUY", "1", "100"),
      fill("BUY", "1", "110"),
      fill("SELL", "0.5", "120"),
      fill("SELL", "1.5", "100"),
    ]);
    expect(p).toMatchObject({ entryPrice: "105", exitPrice: "105", quantity: "2", grossPnl: "0" });
    expect(p?.allocations.map((a) => a.role)).toEqual(["OPEN", "OPEN", "CLOSE", "CLOSE"]);
  });

  it("builds a short round trip", () => {
    const [p] = reconstructPositions([fill("SELL", "2", "50"), fill("BUY", "2", "40")]);
    expect(p).toMatchObject({
      direction: "SHORT",
      grossPnl: "20",
      entryPrice: "50",
      exitPrice: "40",
    });
  });

  it("splits a flip fill between the closing long and the new short", () => {
    const open = fill("BUY", "1", "100", { fee: "0.1" });
    const flip = fill("SELL", "3", "110", { fee: "0.3" });
    const close = fill("BUY", "2", "100", { fee: "0.2" });
    // Not at the start of history (an incremental rebuild from a flat point).
    const [long, short] = reconstructPositions([open, flip, close], { historyStart: false });

    expect(long).toMatchObject({
      direction: "LONG",
      status: "CLOSED",
      grossPnl: "10",
      fees: "0.2",
    });
    expect(long?.allocations).toEqual([
      { fillId: open.id, qty: "1", role: "OPEN" },
      { fillId: flip.id, qty: "1", role: "CLOSE" },
    ]);
    expect(short).toMatchObject({
      direction: "SHORT",
      status: "CLOSED",
      entryPrice: "110",
      grossPnl: "20",
      fees: "0.4",
      openedAt: flip.executedAt,
    });
    expect(short?.allocations[0]).toEqual({ fillId: flip.id, qty: "2", role: "OPEN" });
    expect(long?.sourceKey).not.toBe(short?.sourceKey);
  });

  it("prefers the exchange's realised PnL when every close reports it", () => {
    const [p] = reconstructPositions([
      fill("BUY", "1", "100"),
      fill("SELL", "1", "110", { pnl: "9.99" }),
    ]);
    expect(p?.grossPnl).toBe("9.99");
  });

  it("falls back to its own figure when any close lacks the exchange PnL", () => {
    const [p] = reconstructPositions([
      fill("BUY", "2", "100"),
      fill("SELL", "1", "110", { pnl: "9.99" }),
      fill("SELL", "1", "120"),
    ]);
    expect(p?.grossPnl).toBe("30");
  });

  it("keeps an unfinished position open with realised PnL so far", () => {
    const [p] = reconstructPositions([fill("BUY", "1", "100"), fill("SELL", "0.4", "110")]);
    expect(p).toMatchObject({ status: "OPEN", closedAt: null, openQuantity: "0.6", grossPnl: "4" });
  });

  it("recovers a position that opened before the history window", () => {
    // First visible fill closes a long: realised +10 on 1 @110 means entry was 100.
    const [orphan, next] = reconstructPositions([
      fill("SELL", "1", "110", { pnl: "10" }),
      fill("BUY", "1", "100", { pnl: "0" }),
    ]);
    expect(orphan).toMatchObject({
      direction: "LONG",
      status: "CLOSED",
      incompleteHistory: true,
      entryPrice: "100",
      exitPrice: "110",
      grossPnl: "10",
    });
    expect(next).toMatchObject({ direction: "LONG", status: "OPEN", incompleteHistory: false });
  });

  it("handles exact decimals without floating-point drift", () => {
    const [p] = reconstructPositions([
      fill("BUY", "0.1", "0.3"),
      fill("BUY", "0.2", "0.3"),
      fill("SELL", "0.3", "0.4", { fee: "-0.0001" }),
    ]);
    expect(p).toMatchObject({
      quantity: "0.3",
      grossPnl: "0.03",
      fees: "-0.0001",
      netPnl: "0.0301",
    });
  });
});

describe("reconstructPositions: hedge mode", () => {
  it("keeps long and short tracks independent", () => {
    const positions = reconstructPositions([
      fill("BUY", "1", "100", { ps: "LONG" }),
      fill("SELL", "1", "100", { ps: "SHORT" }),
      fill("SELL", "1", "105", { ps: "LONG" }),
      fill("BUY", "1", "95", { ps: "SHORT" }),
    ]);
    expect(positions.map((p) => [p.direction, p.grossPnl, p.status])).toEqual([
      ["LONG", "5", "CLOSED"],
      ["SHORT", "5", "CLOSED"],
    ]);
  });

  it("flags an orphan close without exchange PnL as incomplete with unknown figures", () => {
    const [p] = reconstructPositions([fill("SELL", "1", "110", { ps: "LONG" })]);
    expect(p).toMatchObject({
      incompleteHistory: true,
      entryPrice: null,
      grossPnl: null,
      netPnl: null,
    });
  });

  it("flags a close larger than the known size instead of flipping", () => {
    const positions = reconstructPositions([
      fill("BUY", "1", "100", { ps: "LONG" }),
      fill("SELL", "2", "110", { ps: "LONG", pnl: "20" }),
    ]);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      status: "CLOSED",
      incompleteHistory: true,
      grossPnl: "20",
    });
  });
});

describe("reconstructPositions: history that starts mid-position (one-way mode)", () => {
  it("closes the first position as incomplete instead of opening a phantom flip", () => {
    // We only saw a later 1-unit addition; the 3-unit close is the whole position closing.
    const positions = reconstructPositions([
      fill("BUY", "1", "100"),
      fill("SELL", "3", "110", { pnl: "25" }),
      fill("BUY", "2", "105"),
      fill("SELL", "2", "115", { pnl: "20" }),
    ]);
    expect(positions).toHaveLength(2);
    expect(positions[0]).toMatchObject({
      status: "CLOSED",
      incompleteHistory: true,
      grossPnl: "25",
    });
    expect(positions[1]).toMatchObject({
      direction: "LONG",
      status: "CLOSED",
      incompleteHistory: false,
      grossPnl: "20",
    });
  });

  it("still splits real flips after the first position", () => {
    const positions = reconstructPositions([
      fill("BUY", "1", "100"),
      fill("SELL", "1", "105", { pnl: "5" }),
      fill("BUY", "1", "100"),
      fill("SELL", "3", "110", { pnl: "10" }),
    ]);
    expect(positions.map((p) => [p.direction, p.status])).toEqual([
      ["LONG", "CLOSED"],
      ["LONG", "CLOSED"],
      ["SHORT", "OPEN"],
    ]);
  });
});

describe("reconstructPositions: ordering and identity", () => {
  it("orders same-millisecond fills by numeric fill ID", () => {
    const t = T0 + 999_000;
    const positions = reconstructPositions([
      fill("SELL", "1", "110", { id: "10", t }),
      fill("BUY", "1", "100", { id: "9", t }),
    ]);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ direction: "LONG", grossPnl: "10" });
  });

  it("is deterministic regardless of input order", () => {
    const fills = [
      fill("BUY", "1", "100"),
      fill("SELL", "3", "110"),
      fill("BUY", "2", "100"),
      fill("BUY", "1", "50", { symbol: "ETHUSDT" }),
    ];
    const a = reconstructPositions(fills);
    const b = reconstructPositions([...fills].reverse());
    expect(b).toEqual(a);
    expect(new Set(a.map((p) => p.sourceKey)).size).toBe(a.length);
  });

  it("separates symbols", () => {
    const positions = reconstructPositions([
      fill("BUY", "1", "100", { symbol: "BTCUSDT" }),
      fill("BUY", "1", "10", { symbol: "ETHUSDT" }),
    ]);
    expect(positions.map((p) => p.symbol).sort()).toEqual(["BTCUSDT", "ETHUSDT"]);
  });
});
