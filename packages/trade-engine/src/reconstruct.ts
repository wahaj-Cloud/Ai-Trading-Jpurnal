import { D, type Dec, dec, str, ZERO } from "./decimal.js";
import type {
  Direction,
  EngineFill,
  FillAllocation,
  PositionSide,
  ReconstructedPosition,
} from "./types.js";

/** Output precision for derived prices (matches the database's NUMERIC(36,18)). */
const PRICE_DP = 18;

/**
 * Rebuilds round-trip positions from fills, per symbol and position side.
 *
 * Rules:
 *  - Average-cost method: the entry price is the size-weighted average of every opening fill;
 *    realised PnL on a close is (exit - average entry) x closed size (reversed for shorts).
 *  - One-way mode (BOTH): a fill larger than the open size closes it and opens the opposite
 *    direction with the remainder ("flip"); the fill is split between the two positions.
 *  - Hedge mode (LONG/SHORT tracks) never flips; a close larger than the known size means history
 *    started mid-position, so the position is flagged incomplete.
 *  - Closing fills with no known opening (history window started mid-position) form an
 *    "incomplete" position; its entry is derived from the exchange's realised PnL when available.
 *  - When every closing fill carries the exchange's realised PnL, that figure is used as gross PnL
 *    (the exchange is the ledger); otherwise our average-cost figure is used.
 */
export function reconstructPositions(
  fills: readonly EngineFill[],
  /**
   * `historyStart`: these fills begin at the start of everything we know for the symbol (true),
   * or at a point where every position was flat (false, incremental rebuilds).
   */
  opts: { historyStart?: boolean } = {},
): ReconstructedPosition[] {
  const historyStart = opts.historyStart ?? true;
  const tracks = new Map<string, EngineFill[]>();
  for (const fill of fills) {
    const key = `${fill.symbol}\u0000${fill.positionSide}`;
    const list = tracks.get(key);
    if (list) list.push(fill);
    else tracks.set(key, [fill]);
  }
  const result: ReconstructedPosition[] = [];
  for (const trackFills of tracks.values()) {
    result.push(...reconstructTrack([...trackFills].sort(compareFills), historyStart));
  }
  return result.sort(
    (a, b) => a.openedAt.getTime() - b.openedAt.getTime() || a.sourceKey.localeCompare(b.sourceKey),
  );
}

export function compareFills(a: EngineFill, b: EngineFill): number {
  const t = a.executedAt.getTime() - b.executedAt.getTime();
  if (t !== 0) return t;
  // Same millisecond: exchange fill IDs are sequential; compare numerically when both are numeric.
  if (/^\d+$/.test(a.id) && /^\d+$/.test(b.id)) {
    const x = BigInt(a.id);
    const y = BigInt(b.id);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

class PositionBuilder {
  openedAt: Date;
  closedAt: Date | null = null;
  size = ZERO; // currently open, always >= 0
  maxSize = ZERO;
  openCost = ZERO;
  openQty = ZERO;
  closeValue = ZERO;
  closeQty = ZERO;
  computedPnl = ZERO;
  exchangePnl = ZERO;
  exchangePnlComplete = true;
  fees = ZERO;
  incomplete: boolean;
  readonly allocations: FillAllocation[] = [];
  readonly sourceKey: string;

  constructor(
    readonly symbol: string,
    readonly positionSide: PositionSide,
    readonly direction: Direction,
    first: EngineFill,
    readonly orphan: boolean,
  ) {
    this.openedAt = first.executedAt;
    this.incomplete = orphan;
    this.sourceKey = `F:${symbol}:${positionSide}:${first.id}:${orphan ? "orphan" : "open"}`;
  }

  addOpen(fill: EngineFill, qty: Dec, share: Dec): void {
    const price = dec(fill.price);
    this.size = this.size.plus(qty);
    this.maxSize = D.max(this.maxSize, this.size);
    this.openCost = this.openCost.plus(qty.times(price));
    this.openQty = this.openQty.plus(qty);
    this.fees = this.fees.plus(dec(fill.fee).times(share));
    this.allocations.push({ fillId: fill.id, qty: str(qty), role: "OPEN" });
  }

  /** `realizedShare` is the part of the fill's exchange PnL that belongs to this close. */
  addClose(fill: EngineFill, qty: Dec, feeShare: Dec, realizedShare: Dec): void {
    const price = dec(fill.price);
    if (!this.orphan && this.openQty.gt(0)) {
      const avgEntry = this.openCost.div(this.openQty);
      const perUnit = this.direction === "LONG" ? price.minus(avgEntry) : avgEntry.minus(price);
      this.computedPnl = this.computedPnl.plus(perUnit.times(qty));
    }
    if (fill.realizedPnl === null) this.exchangePnlComplete = false;
    else this.exchangePnl = this.exchangePnl.plus(dec(fill.realizedPnl).times(realizedShare));

    this.size = D.max(this.size.minus(qty), ZERO);
    this.closeValue = this.closeValue.plus(qty.times(price));
    this.closeQty = this.closeQty.plus(qty);
    this.fees = this.fees.plus(dec(fill.fee).times(feeShare));
    this.closedAt = fill.executedAt;
    this.allocations.push({ fillId: fill.id, qty: str(qty), role: "CLOSE" });
  }

  build(status: "OPEN" | "CLOSED"): ReconstructedPosition {
    const hasClose = this.closeQty.gt(0);
    const gross = !hasClose
      ? ZERO
      : this.exchangePnlComplete
        ? this.exchangePnl
        : this.orphan
          ? null
          : this.computedPnl;

    const exitPrice = hasClose ? this.closeValue.div(this.closeQty) : null;
    let entryPrice: Dec | null = this.openQty.gt(0) ? this.openCost.div(this.openQty) : null;
    if (this.orphan && exitPrice && this.exchangePnlComplete) {
      // pnl = (exit - entry) x qty for longs, (entry - exit) x qty for shorts.
      const perUnit = this.exchangePnl.div(this.closeQty);
      entryPrice = this.direction === "LONG" ? exitPrice.minus(perUnit) : exitPrice.plus(perUnit);
    }

    const quantity = this.orphan ? this.closeQty : this.maxSize;
    return {
      sourceKey: this.sourceKey,
      symbol: this.symbol,
      positionSide: this.positionSide,
      direction: this.direction,
      status,
      openedAt: this.openedAt,
      closedAt: status === "CLOSED" ? this.closedAt : null,
      entryPrice: entryPrice ? str(entryPrice.toDecimalPlaces(PRICE_DP)) : null,
      exitPrice: exitPrice ? str(exitPrice.toDecimalPlaces(PRICE_DP)) : null,
      quantity: str(quantity),
      leverage: null,
      grossPnl: gross === null ? null : str(gross),
      fees: str(this.fees),
      funding: null,
      netPnl: gross === null ? null : str(gross.minus(this.fees)),
      incompleteHistory: this.incomplete,
      openQuantity: status === "CLOSED" ? "0" : str(this.size),
      allocations: this.allocations,
    };
  }
}

function reconstructTrack(fills: EngineFill[], historyStart: boolean): ReconstructedPosition[] {
  const out: ReconstructedPosition[] = [];
  let pos: PositionBuilder | null = null;
  /** The track's first position when history starts here: we may have joined it mid-way. */
  let firstOfHistory = false;
  const ONE = dec(1);

  for (const fill of fills) {
    const qty = dec(fill.qty);
    if (qty.lte(0)) continue; // defensive: zero-size fills carry no position information
    const buy = fill.side === "BUY";
    const track = fill.positionSide;

    if (pos === null || pos.orphan) {
      if (isClosingWithoutOpen(fill)) {
        const direction = closedDirection(fill);
        if (pos && pos.direction !== direction) {
          out.push(pos.build("CLOSED"));
          pos = null;
        }
        pos ??= new PositionBuilder(fill.symbol, track, direction, fill, true);
        pos.addClose(fill, qty, ONE, ONE);
        continue;
      }
      if (pos) out.push(pos.build("CLOSED"));
      const direction: Direction = track === "BOTH" ? (buy ? "LONG" : "SHORT") : track;
      firstOfHistory = historyStart && out.length === 0;
      pos = new PositionBuilder(fill.symbol, track, direction, fill, false);
      pos.addOpen(fill, qty, ONE);
      continue;
    }

    const increases = (pos.direction === "LONG") === buy;
    if (increases) {
      pos.addOpen(fill, qty, ONE);
      continue;
    }

    if (track !== "BOTH") {
      // Hedge tracks cannot flip: an oversized close means we never saw part of the opening.
      if (qty.gt(pos.size)) pos.incomplete = true;
      pos.addClose(fill, qty, ONE, ONE);
      if (pos.size.isZero()) {
        out.push(pos.build("CLOSED"));
        pos = null;
      }
      continue;
    }

    if (firstOfHistory && qty.gt(pos.size)) {
      // History began part-way through this position (we saw only later additions), so a close
      // larger than what we saw is the rest of it closing, not a flip: opening the remainder would
      // create a phantom position that swallows the next real fills.
      pos.incomplete = true;
      pos.addClose(fill, qty, ONE, ONE);
      out.push(pos.build("CLOSED"));
      pos = null;
      firstOfHistory = false;
      continue;
    }
    const closeQty = D.min(qty, pos.size);
    const closeShare = closeQty.div(qty);
    // The exchange books all realised PnL of a flip fill on its closing part.
    pos.addClose(fill, closeQty, closeShare, ONE);
    const remainder = qty.minus(closeQty);
    if (pos.size.isZero()) {
      out.push(pos.build("CLOSED"));
      pos = null;
    }
    if (remainder.gt(0)) {
      const direction: Direction = buy ? "LONG" : "SHORT";
      pos = new PositionBuilder(fill.symbol, track, direction, fill, false);
      pos.addOpen(fill, remainder, remainder.div(qty));
    }
  }

  if (pos) out.push(pos.build(pos.orphan ? "CLOSED" : "OPEN"));
  return out;
}

/** A fill that reduces a position we never saw open (history window started mid-position). */
function isClosingWithoutOpen(fill: EngineFill): boolean {
  if (fill.positionSide === "LONG") return fill.side === "SELL";
  if (fill.positionSide === "SHORT") return fill.side === "BUY";
  // One-way mode: only the exchange's realised PnL tells a close from an open.
  return fill.realizedPnl !== null && !dec(fill.realizedPnl).isZero();
}

function closedDirection(fill: EngineFill): Direction {
  if (fill.positionSide !== "BOTH") return fill.positionSide;
  return fill.side === "SELL" ? "LONG" : "SHORT";
}
