import { signedPct } from "@atc/shared";

/** Shared by the server views and the client visual. */
const NAMES: Record<string, string> = { XAUUSDT: "Gold", XAGUSDT: "Silver" };
export const coinName = (s: string) => NAMES[s] ?? s.replace(/USDT$/, "");

const compact = new Map<number, Intl.NumberFormat>();
export const usd = (v: number, digits = 2) => {
  let f = compact.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: digits });
    compact.set(digits, f);
  }
  const body = f.format(Math.abs(v));
  // The sign follows the amount as shown: nothing in front of $0.
  const sign = body === "0" ? "" : v < 0 ? "−" : v > 0 ? "+" : "";
  return `${sign}$${body}`;
};

export const pct = (v: number | null, digits = 2) => (v === null ? "—" : signedPct(v, digits));
