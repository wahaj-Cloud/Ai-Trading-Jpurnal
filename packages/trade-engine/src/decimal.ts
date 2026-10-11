import { Decimal as DecimalLib } from "decimal.js";

/**
 * Money and quantities are exact decimals end to end. Values cross package boundaries as strings;
 * floating-point numbers never touch financial data.
 */
export const D = DecimalLib.clone({ precision: 40, rounding: DecimalLib.ROUND_HALF_EVEN });
export type Dec = InstanceType<typeof D>;

export const ZERO = new D(0);

export function dec(value: string | number | Dec): Dec {
  return new D(value);
}

/** Canonical string form: no exponent, no trailing zeros ("1.50" -> "1.5", "-0" -> "0"). */
export function str(value: Dec): string {
  if (value.isZero()) return "0";
  return value.toFixed();
}

export function sum(values: Iterable<Dec>): Dec {
  let total = ZERO;
  for (const v of values) total = total.plus(v);
  return total;
}
