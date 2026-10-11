import { type Dec, dec, str, sum, ZERO } from "./decimal.js";
import type { DerivedPosition } from "./types.js";

export interface FundingEvent {
  id: string;
  symbol: string;
  /** Positive = received, negative = paid. */
  amount: string;
  occurredAt: Date;
}

export interface FundingAttribution {
  bySourceKey: Map<string, Dec>;
  /** Events with no matching position (e.g. positions opened before downloaded history). */
  unattributed: FundingEvent[];
}

/**
 * Funding is charged per symbol at settlement times, without saying which position paid it.
 * An event belongs to the position(s) on that symbol open at that instant (bounds inclusive).
 * Overlapping positions (hedge mode: long and short at once) share it in proportion to size.
 */
export function attributeFunding(
  positions: readonly Pick<
    DerivedPosition,
    "sourceKey" | "symbol" | "openedAt" | "closedAt" | "quantity"
  >[],
  events: readonly FundingEvent[],
): FundingAttribution {
  const bySymbol = new Map<string, typeof positions>();
  for (const p of positions) bySymbol.set(p.symbol, [...(bySymbol.get(p.symbol) ?? []), p]);

  const bySourceKey = new Map<string, Dec>();
  const unattributed: FundingEvent[] = [];

  for (const event of events) {
    const t = event.occurredAt.getTime();
    const open = (bySymbol.get(event.symbol) ?? []).filter(
      (p) => p.openedAt.getTime() <= t && (p.closedAt === null || t <= p.closedAt.getTime()),
    );
    if (open.length === 0) {
      unattributed.push(event);
      continue;
    }
    const amount = dec(event.amount);
    const weights = open.map((p) => (p.quantity ? dec(p.quantity) : ZERO));
    const totalWeight = sum(weights);
    open.forEach((p, i) => {
      const share = totalWeight.isZero()
        ? amount.div(open.length)
        : amount.times(weights[i] ?? ZERO).div(totalWeight);
      bySourceKey.set(p.sourceKey, (bySourceKey.get(p.sourceKey) ?? ZERO).plus(share));
    });
  }
  return { bySourceKey, unattributed };
}

/** Returns the position with funding applied and net PnL recomputed: gross - fees + funding. */
export function withFunding<P extends DerivedPosition>(position: P, funding: Dec): P {
  const gross = position.grossPnl === null ? null : dec(position.grossPnl);
  const fees = position.fees === null ? ZERO : dec(position.fees);
  return {
    ...position,
    funding: str(funding),
    netPnl: gross === null ? null : str(gross.minus(fees).plus(funding)),
  };
}
