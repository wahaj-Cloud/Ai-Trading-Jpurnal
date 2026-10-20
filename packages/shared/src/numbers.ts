/**
 * Signed number text. The sign follows the value as shown (after rounding), so a tiny negative
 * such as −0.0004 reads "0.00", never "−0.00", and zero has no sign. Uses the true minus sign (−).
 */
export function signedFixed(v: number, digits: number): string {
  if (!Number.isFinite(v)) return "—";
  const body = Math.abs(v).toFixed(digits);
  if (Number(body) === 0) return body;
  return `${v > 0 ? "+" : "−"}${body}`;
}

/** `signedFixed` with a percent sign: +1.25%, −0.40%, 0.00%. */
export const signedPct = (v: number, digits = 2): string => `${signedFixed(v, digits)}%`;

/** Signed dollars with thousands separators: +$1,234.50, −$12.00, $0.00. */
export function signedUsd(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (Number(abs.toFixed(digits)) === 0) return `$${body}`;
  return `${v > 0 ? "+" : "−"}$${body}`;
}

/** Unsigned style for values that can be negative (correlation, beta): 0.86, −0.60, 0.00. */
export function fixedMinus(v: number, digits: number): string {
  if (!Number.isFinite(v)) return "—";
  const body = Math.abs(v).toFixed(digits);
  return v < 0 && Number(body) !== 0 ? `−${body}` : body;
}

/** Prices to a sensible number of decimals for their size (63,512.4 · 0.15432 · 0.00001234). */
export function formatPrice(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 1 : abs >= 1 ? 3 : abs >= 0.01 ? 5 : 8;
  return v.toLocaleString("en", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
