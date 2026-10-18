import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  /** Same master keys as the API: the worker is the only service that decrypts credentials. */
  CREDENTIAL_KEYS: z.string().min(1).optional(),
  /** AWS-KMS-encrypted master keys (production); replaces CREDENTIAL_KEYS. */
  CREDENTIAL_KEYS_KMS: z.string().min(1).optional(),
  CREDENTIAL_ACTIVE_KEY_ID: z.string().default("v1"),
  /** How often each account is synced. */
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
  /** Accounts synced in parallel by one worker process. */
  SYNC_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
  BINANCE_SPOT_BASE_URL: z.url().optional(),
  BINANCE_FUTURES_BASE_URL: z.url().optional(),
  MEXC_BASE_URL: z.url().optional(),
  KUCOIN_SPOT_BASE_URL: z.url().optional(),
  KUCOIN_FUTURES_BASE_URL: z.url().optional(),
  BINGX_BASE_URL: z.url().optional(),
  BYBIT_BASE_URL: z.url().optional(),
  /** Fixes the OKX host; without it the regional hosts (global, EEA, US) are tried in turn. */
  OKX_BASE_URL: z.url().optional(),
  /** AI coach. Without a key, AI features are off; rules-based grades and insights still work. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_BASE_URL: z.url().optional(),
  /** High-volume structured work (trade reviews, coaching notes). */
  AI_FAST_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  /** Conversation (used by the API; accepted here so both services share one variable set). */
  AI_SMART_MODEL: z.string().default("claude-sonnet-5"),
  AI_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  /** Email (resend.com). Without a key, notifications are in-app only. */
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().default("WickMentor <coach@example.com>"),
  /** Public web address used in email links, e.g. https://app.yourdomain.com */
  APP_URL: z.url().default("http://localhost:3000"),
  SENTRY_DSN: z.url().optional(),
  /** MetaApi (metaapi.cloud) API access token: syncs MetaTrader brokers such as Exness. */
  METAAPI_TOKEN: z.string().min(20).optional(),
  /** Test or self-hosted override of MetaApi's provisioning host. */
  METAAPI_PROVISIONING_URL: z.url().optional(),
  /**
   * Live economic results (Trading Economics streaming, "key:secret"). With it, released figures
   * such as CPI reach users within seconds; without it the calendar shows schedules only.
   */
  TE_STREAM_KEY: z.string().min(3).optional(),
  TE_STREAM_URL: z.url().default("wss://stream.tradingeconomics.com/"),
  /**
   * Free US Bureau of Labor Statistics API key (data.bls.gov/registrationEngine): live CPI, PPI and
   * jobs-report figures straight from the publisher.
   */
  BLS_API_KEY: z.string().min(10).optional(),
  /**
   * Market-moving headlines (world events, central banks, crypto, economy) from Finnhub, the Fed,
   * the ECB, GDELT and the Trading Economics stream.
   */
  NEWS_HEADLINES_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** Free Finnhub key (finnhub.io/register): Reuters, CNBC and MarketWatch headlines every 15 s. */
  FINNHUB_API_KEY: z.string().min(10).optional(),
  /** Market Pulse (hourly BTC correlations from public Binance data). */
  MARKET_PULSE_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** Estimated liquidation maps (public open interest from Binance, Bybit and OKX, every 5 min). */
  LIQ_MAP_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** Market Flow: live whale trades and liquidations from Binance, Bybit and OKX public feeds. */
  MARKET_FLOW_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** Market Context Desk: drivers for BTC, ETH, SOL, gold and silver every 15 minutes. */
  MARKET_DESK_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** Trade Check readings (long/short ratios, basis, Coinbase premium, options, macro) every 15 min. */
  MARKET_CONTEXT_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /**
   * Free FRED API key (fredaccount.stlouisfed.org): the dollar index, US 10-year yield, S&P 500,
   * Nasdaq and VIX on Trade Check. Without it the macro rows are hidden.
   */
  FRED_API_KEY: z.string().min(10).optional(),
  /** Dashboard market overview from CoinMarketCap (works without a key). */
  MARKET_OVERVIEW_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /**
   * Optional free CoinMarketCap API key (coinmarketcap.com/api, Basic plan). Not needed for the
   * live readings; with it, the 7-day market-cap chart is filled straight away on a new install.
   */
  CMC_API_KEY: z.string().min(10).optional(),
  /** Strategy Lab backtests run at once by one worker process (CPU-heavy: keep low). */
  BACKTEST_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
});

export type WorkerEnv = z.infer<typeof envSchema>;

/**
 * Hosting dashboards make it easy to save a variable with an empty value or stray spaces. Both are
 * treated as "not set" / trimmed, so an empty optional setting never stops the service starting.
 */
function cleanSource(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    const value = v?.trim();
    if (value) out[k] = value;
  }
  return out;
}
export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = envSchema.safeParse(cleanSource(source));
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid worker configuration:\n${details}`);
  }
  return parsed.data;
}
