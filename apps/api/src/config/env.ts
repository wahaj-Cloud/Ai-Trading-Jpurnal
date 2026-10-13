import { z } from "zod";

const csv = z
  .string()
  .transform((v) =>
    v
      .split(",")
      // "https://app.example.com/" and "https://app.example.com" are the same origin.
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean),
  )
  .pipe(z.array(z.url()).min(1));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url(),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().startsWith("whsec_"),
  /** Comma-separated web origins allowed to call the API and to have issued session tokens. */
  WEB_ORIGINS: csv,
  /** Number of reverse proxies in front of the API (Railway = 1). Needed for correct client IPs. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
  /** Job queue shared with the sync worker. */
  REDIS_URL: z.url(),
  /** Plain master keys, or (production) CREDENTIAL_KEYS_KMS with AWS-KMS-encrypted ones. One is required. */
  CREDENTIAL_KEYS: z.string().min(1).optional(),
  CREDENTIAL_KEYS_KMS: z.string().min(1).optional(),
  CREDENTIAL_ACTIVE_KEY_ID: z.string().default("v1"),
  /**
   * MetaTrader brokers (Exness) are synced by the worker through MetaApi (its token lives only on
   * the worker). This switch lets users start connecting them.
   */
  EXNESS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Static outbound IPs shown to users for exchange IP whitelisting. */
  EXCHANGE_EGRESS_IPS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.union([z.ipv4(), z.ipv6()]))),
  /** Exchange base-URL overrides, for testnets (e.g. BingX VST) and local testing only. */
  BINANCE_SPOT_BASE_URL: z.url().optional(),
  BINANCE_FUTURES_BASE_URL: z.url().optional(),
  MEXC_BASE_URL: z.url().optional(),
  KUCOIN_SPOT_BASE_URL: z.url().optional(),
  KUCOIN_FUTURES_BASE_URL: z.url().optional(),
  BINGX_BASE_URL: z.url().optional(),
  /** AI coach. Without a key, AI features are off; rules-based grades and insights still work. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_BASE_URL: z.url().optional(),
  /** Daily USD exchange rates (no key needed). Must return { result, base_code, rates, time_last_update_unix }. */
  FX_RATES_URL: z.url().default("https://open.er-api.com/v6/latest/USD"),
  /** Economic calendar weekly export (ForexFactory JSON). Read at most hourly. */
  ECON_CALENDAR_URL: z.url().default("https://nfs.faireconomy.media/ff_calendar_thisweek.json"),
  /** Next week's export, when the source publishes it. Set empty to skip. */
  ECON_CALENDAR_NEXT_URL: z
    .string()
    .default("https://nfs.faireconomy.media/ff_calendar_nextweek.json")
    .transform((v) => v.trim() || undefined)
    .pipe(z.url().optional()),
  AI_FAST_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  AI_SMART_MODEL: z.string().default("claude-sonnet-5"),
  /** Billing (paddle.com). Without these, online checkout is off; plans can still be granted by admins. */
  PADDLE_API_KEY: z.string().min(1).optional(),
  PADDLE_WEBHOOK_SECRET: z.string().min(1).optional(),
  PADDLE_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  /** "PRO:month:pri_...,PRO:year:pri_...,PREMIUM:month:pri_...,PREMIUM:year:pri_..." */
  PADDLE_PRICES: z
    .string()
    .default("")
    .transform((v, ctx) => {
      const out: { plan: "PRO" | "PREMIUM"; interval: "month" | "year"; priceId: string }[] = [];
      for (const part of v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)) {
        const [plan, interval, priceId] = part.split(":");
        if (
          (plan !== "PRO" && plan !== "PREMIUM") ||
          (interval !== "month" && interval !== "year") ||
          !priceId?.startsWith("pri_")
        ) {
          ctx.addIssue({
            code: "custom",
            message: `Invalid price entry "${part}" (use PLAN:month|year:pri_...)`,
          });
          return z.NEVER;
        }
        if (
          out.some((p) => p.priceId === priceId || (p.plan === plan && p.interval === interval))
        ) {
          ctx.addIssue({ code: "custom", message: `Duplicate price entry "${part}"` });
          return z.NEVER;
        }
        out.push({ plan, interval, priceId });
      }
      return out;
    }),
  SENTRY_DSN: z.url().optional(),
  /** Comma-separated emails that get admin access (verified sign-in emails). */
  ADMIN_EMAILS: z
    .string()
    .default("")
    .transform(
      (v) =>
        new Set(
          v
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
        ),
    ),
});

const checkedEnvSchema = envSchema.superRefine((env, ctx) => {
  // Selling plans without webhooks would take payments that never upgrade anyone.
  if (env.PADDLE_PRICES.length > 0) {
    for (const key of ["PADDLE_WEBHOOK_SECRET", "PADDLE_API_KEY"] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Required when PADDLE_PRICES is set",
        });
      }
    }
  }
  if (!env.CREDENTIAL_KEYS && !env.CREDENTIAL_KEYS_KMS) {
    ctx.addIssue({
      code: "custom",
      path: ["CREDENTIAL_KEYS"],
      message: "Set CREDENTIAL_KEYS or CREDENTIAL_KEYS_KMS",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

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
/** Fails fast at boot with a readable message instead of failing later at runtime. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = checkedEnvSchema.safeParse(cleanSource(source));
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}

export const ENV = Symbol("ENV");
