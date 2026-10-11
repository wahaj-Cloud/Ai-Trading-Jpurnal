/**
 * Display formatting only. Values arrive as exact decimal strings; converting to Number here is
 * safe because nothing is calculated from the result.
 */
const money = new Intl.NumberFormat("en", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});
const plain = new Intl.NumberFormat("en", { maximumFractionDigits: 8 });

const coin = new Intl.NumberFormat("en", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
  signDisplay: "exceptZero",
});
const USD = new Set(["USDT", "USDC", "FDUSD", "BUSD", "USD"]);

/**
 * Signed money. USD amounts show cents; amounts in a coin (e.g. 0.0034 BTC on coin-margined
 * contracts) keep up to 8 decimals so they never read as "+0.00".
 */
export function formatPnl(value: string | null, asset?: string): string {
  if (value === null) return "—";
  const f = asset && !USD.has(asset) ? coin : money;
  return f.format(Number(value)).replace("-", "−");
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

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const compactMoney = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/** Short signed amount for chart labels: +1.2K, −350. */
export function formatPnlCompact(value: string | number | null): string {
  if (value === null) return "—";
  const n = Number(value);
  return Math.abs(n) < 1000 ? formatPnl(String(n)) : compactMoney.format(n).replace("-", "−");
}

/** Unsigned money: fees, averages, drawdown. */
export function formatMoney(value: string | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
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
