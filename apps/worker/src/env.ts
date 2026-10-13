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
