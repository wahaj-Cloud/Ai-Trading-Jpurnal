/**
 * Display formatting only. Values arrive as exact decimal strings; converting to Number here is
 * safe because nothing is calculated from the result.
 */
import { cache } from "react";

const plain = new Intl.NumberFormat("en", { maximumFractionDigits: 8 });
const coin = new Intl.NumberFormat("en", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
  signDisplay: "exceptZero",
});
const USD = new Set(["USDT", "USDC", "FDUSD", "BUSD", "USD"]);
/** Government currencies (the display currency): shown with their symbol, like USD. */
const FIAT: ReadonlySet<string> = new Set(
  Intl.supportedValuesOf("currency").filter((c) => !c.startsWith("X")),
);

/** True for amounts settled in a coin (e.g. BTC on inverse contracts): no currency symbol. */
export function isCoinAsset(asset?: string | null): boolean {
  return Boolean(asset && !USD.has(asset) && !FIAT.has(asset));
}

/**
 * The currency this server request shows amounts in. Set once per request by getDisplay() (which
 * every data loader awaits before anything is rendered); defaults to USD. Client components pass
 * the currency explicitly instead.
 */
const requestCurrency = cache((): { code: string } => ({ code: "USD" }));
export function setRequestCurrency(code: string): void {
  requestCurrency().code = code;
}
function currentCode(asset?: string | null): string {
  if (asset && USD.has(asset)) return "USD";
  if (asset && FIAT.has(asset)) return asset;
  try {
    return requestCurrency().code;
  } catch {
    return "USD";
  }
}

const formats = new Map<string, Intl.NumberFormat>();
function currencyFormat(code: string, kind: "signed" | "plain" | "compact"): Intl.NumberFormat {
  const key = `${code}:${kind}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      ...(kind !== "plain" && { signDisplay: "exceptZero" as const }),
      // Always two decimals: browsers and servers ship different currency data (e.g. whether
      // rupees show paisa), and the page must read the same in both.
      ...(kind !== "compact" && { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      ...(kind === "compact" && {
        notation: "compact" as const,
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      }),
    });
    formats.set(key, f);
  }
  return f;
}
const minus = (s: string) => s.replace("-", "−");

/**
 * Signed money with its currency symbol: +$533.13, −Rs 1,235, +¥35.00. `asset` names the currency
 * of the value when known (a trade's settlement asset); otherwise the display currency is used.
 * Coin amounts (e.g. 0.0034 BTC) keep up to 8 decimals and no symbol.
 */
export function formatPnl(value: string | null, asset?: string | null): string {
  if (value === null) return "—";
  if (isCoinAsset(asset)) return minus(coin.format(Number(value)));
  return minus(currencyFormat(currentCode(asset), "signed").format(Number(value)));
}

/** Unsigned amount (fees): currency symbol for money, full precision for coins. */
export function formatAmount(value: string | null, asset?: string | null): string {
  if (value === null) return "—";
  if (isCoinAsset(asset)) return plain.format(Number(value));
  return formatMoney(value, asset);
}

export function pnlTone(value: string | null): "profit" | "loss" | "flat" {
  if (value === null) return "flat";
  const n = Number(value);
  return n > 0 ? "profit" : n < 0 ? "loss" : "flat";
}

/** Prices and sizes: as many decimals as the market uses (up to 8), no trailing zeros. */
export function formatNumber(value: string | null): string {
  return value === null ? "—" : plain.format(Number(value));
}

/**
 * A position's size as the trader knows it: lots for MetaTrader brokers (Exness: "0.10 lot"),
 * coins or contracts for crypto exchanges ("0.25 BTC").
 */
export function formatSize(p: {
  quantity: string | null;
  lots?: string | null;
  sizeAsset: string;
}): { value: string; unit: string } {
  if (p.lots !== null && p.lots !== undefined) {
    const n = Number(p.lots);
    return { value: n.toFixed(2), unit: n === 1 ? "lot" : "lots" };
  }
  return { value: formatNumber(p.quantity), unit: p.sizeAsset };
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Short signed amount for chart labels: +$1.2K, −Rs 350. */
export function formatPnlCompact(value: string | number | null, asset?: string | null): string {
  if (value === null) return "—";
  const n = Number(value);
  if (Math.abs(n) < 1000) return formatPnl(String(n), asset);
  return minus(currencyFormat(currentCode(asset), "compact").format(n));
}

const tinyCompact3 = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumSignificantDigits: 3,
});
const tinyCompact2 = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumSignificantDigits: 2,
});

/**
 * Signed amount without a currency symbol, at most 5 characters ("+473K", "−1.2M", "+85"), for
 * very small spaces such as calendar cells on phones. The surrounding view names the currency.
 */
export function formatSignedTiny(value: string | number | null): string {
  if (value === null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "0";
  const abs = Math.abs(n);
  const body =
    abs < 1000
      ? String(Math.round(abs))
      : (abs >= 1_000_000 ? tinyCompact2 : tinyCompact3).format(abs);
  return `${n > 0 ? "+" : "−"}${body}`;
}

/** Unsigned money with its currency symbol: fees, averages, drawdown. */
export function formatMoney(value: string | null, asset?: string | null): string {
  if (value === null) return "—";
  return minus(currencyFormat(currentCode(asset), "plain").format(Number(value)));
}

/** 0.5372 -> "53.7%" */
export function formatPercent(value: number | null, digits = 1): string {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

/** Ratios such as profit factor: "1.85". */
export function formatRatio(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

/** R multiples keep their sign: "+2.0R", "−1.5R". */
export function formatR(value: number | null): string {
  if (value === null) return "—";
  const s = `${Math.abs(value).toFixed(1)}R`;
  return value > 0 ? `+${s}` : value < 0 ? `−${s}` : s;
}
