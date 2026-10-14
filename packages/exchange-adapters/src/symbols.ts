import type { ExchangeId } from "@atc/shared";

export interface CanonicalSymbol {
  /** Journal-wide name, e.g. "BTCUSDT", identical across exchanges. */
  symbol: string;
  base: string;
  quote: string;
  /**
   * Currency PnL is paid in. "USD"-quoted futures are inverse (coin-margined) contracts that settle in
   * the base coin; every other quote (USDT, USDC, ...) is a linear contract settling in the quote.
   */
  settle: string;
  /** True for inverse contracts, whose size is counted in USD rather than coins. */
  inverse: boolean;
}

// Longest first so "FDUSD" is not mistaken for "USD".
const QUOTES = ["FDUSD", "USDT", "USDC", "BUSD", "USD"];
const BASE_ALIASES: Record<string, string> = { XBT: "BTC" };

/**
 * Normalises exchange-native futures symbols:
 * Binance "BTCUSDT", MEXC "BTC_USDT", KuCoin "XBTUSDTM", BingX "BTC-USDT", OKX "BTC-USDT-SWAP"
 * -> "BTCUSDT"; Bybit's USDC perpetuals "BTCPERP" -> "BTCUSDC".
 */
export function canonicalSymbol(exchange: ExchangeId, native: string): CanonicalSymbol {
  if (exchange === "EXNESS") return metatraderSymbol(native);
  let raw = native.trim().toUpperCase();
  // KuCoin perpetuals end in "M" (XBTUSDTM); strip it only when a quote currency precedes it.
  if (
    exchange === "KUCOIN" &&
    raw.endsWith("M") &&
    QUOTES.some((q) => raw.slice(0, -1).endsWith(q))
  ) {
    raw = raw.slice(0, -1);
  }

  // OKX perpetuals end in "-SWAP"; Bybit names its USDC perpetuals "<BASE>PERP".
  if (exchange === "OKX" && raw.endsWith("-SWAP")) raw = raw.slice(0, -"-SWAP".length);
  if (exchange === "BYBIT" && raw.endsWith("PERP") && raw.length > 4)
    raw = `${raw.slice(0, -4)}USDC`;

  // Dated delivery contracts (Binance "BTCUSDT_260327") keep their expiry in the symbol, so they never
  // merge with the perpetual, but the pair itself is parsed without it.
  const expiry = /_(\d{6})$/.exec(raw)?.[1];
  if (expiry) raw = raw.slice(0, -expiry.length - 1);

  const separated = raw.split(/[-_/]/).filter(Boolean);
  let base: string;
  let quote: string;
  if (separated.length === 2) {
    [base, quote] = separated as [string, string];
  } else {
    const q = QUOTES.find((candidate) => raw.endsWith(candidate) && raw.length > candidate.length);
    base = q ? raw.slice(0, -q.length) : raw;
    quote = q ?? "";
  }
  base = BASE_ALIASES[base] ?? base;
  const inverse = quote === "USD";
  return {
    symbol: `${base}${quote}${expiry ? `_${expiry}` : ""}`,
    base,
    quote,
    settle: inverse ? base : quote,
    inverse,
  };
}

/** ISO currency and metal codes that appear in forex and metal pairs. */
const FX_CODES = new Set([
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CHF",
  "AUD",
  "NZD",
  "CAD",
  "SGD",
  "HKD",
  "NOK",
  "SEK",
  "DKK",
  "PLN",
  "HUF",
  "CZK",
  "TRY",
  "ZAR",
  "MXN",
  "CNH",
  "THB",
  "INR",
  "IDR",
  "MYR",
  "PHP",
  "KRW",
  "AED",
  "SAR",
  "ILS",
  "BRL",
  "ARS",
  "CLP",
  "COP",
  "KWD",
  "QAR",
  "XAU",
  "XAG",
  "XPT",
  "XPD",
]);

/**
 * MetaTrader broker symbols (Exness). The account type is a lower-case suffix ("XAUUSDm" Standard,
 * "EURUSDc" Cent), which is dropped so one market has one name. Pairs ("EURUSD", "XAUUSD") and
 * coins quoted in USD ("BTCUSD") split into base and quote; stocks and indices ("AAPL", "USTEC") are
 * quoted in USD. These are CFDs: never inverse, and PnL is paid in the account currency (USD unless
 * the account says otherwise).
 */
function metatraderSymbol(native: string): CanonicalSymbol {
  const symbol = native
    .trim()
    .replace(/[a-z]+$/, "")
    .toUpperCase();
  let base = symbol;
  let quote = "USD";
  if (
    /^[A-Z]{6}$/.test(symbol) &&
    FX_CODES.has(symbol.slice(0, 3)) &&
    FX_CODES.has(symbol.slice(3))
  ) {
    base = symbol.slice(0, 3);
    quote = symbol.slice(3);
  } else if (/^[A-Z0-9]{2,}USD$/.test(symbol)) {
    base = symbol.slice(0, -3);
  }
  return { symbol, base, quote, settle: "USD", inverse: false };
}
