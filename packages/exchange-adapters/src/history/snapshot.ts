import { type Dec, dec, str } from "@atc/trade-engine";

/** Decimal from an exchange field, or null when missing or blank. */
export const num = (v: unknown): Dec | null =>
  v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : dec(String(v));

/** Decimal string for a strictly positive field (exchanges report "0" for "not applicable"). */
export function positive(v: unknown): string | null {
  const n = num(v);
  return n?.gt(0) ? str(n) : null;
}

/** Signed decimal string, or null. */
export function signed(v: unknown): string | null {
  const n = num(v);
  return n ? str(n) : null;
}

/**
 * Unrealised PnL from prices, for exchanges that do not report it.
 * Linear: (mark - entry) x size. Inverse (size in USD): size x (1/entry - 1/mark), paid in coins.
 * Both are negated for shorts.
 */
export function unrealizedFromPrices(input: {
  direction: "LONG" | "SHORT";
  size: Dec;
  entry: Dec;
  mark: Dec;
  inverse: boolean;
}): string | null {
  const { direction, size, entry, mark, inverse } = input;
  if (entry.isZero() || mark.isZero()) return null;
  const long = inverse
    ? size.times(dec(1).div(entry).minus(dec(1).div(mark)))
    : mark.minus(entry).times(size);
  return str((direction === "LONG" ? long : long.neg()).toDecimalPlaces(18));
}
