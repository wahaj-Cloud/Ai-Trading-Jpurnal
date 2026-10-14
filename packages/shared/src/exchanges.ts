import { z } from "zod";

/**
 * Single source of truth for which exchanges exist and how users connect them.
 * The API (adapters) and the web app (forms, guides) both read this catalog.
 */
export const EXCHANGE_IDS = ["BINANCE", "MEXC", "KUCOIN", "BINGX", "EXNESS"] as const;
export type ExchangeId = (typeof EXCHANGE_IDS)[number];

/**
 * How a venue is connected:
 *  - API_KEY: a read-only API key (crypto exchanges);
 *  - METATRADER: a MetaTrader 4/5 account number, investor (read-only) password and server name,
 *    synced through MetaApi (forex and CFD brokers such as Exness).
 */
export type ConnectionKind = "API_KEY" | "METATRADER";

export interface ExchangeInfo {
  id: ExchangeId;
  name: string;
  kind: ConnectionKind;
  /** The product we journal, as the venue names it. */
  product: string;
  /** KuCoin-style keys carry a third secret chosen by the user when creating the key. */
  needsPassphrase: boolean;
  /** Where users create API keys (API_KEY) or find their account details (METATRADER). */
  apiManagementUrl: string;
  /** Known limit on how far back the venue's API returns trades, if any. */
  historyLimitNote: string | null;
  /** METATRADER: an example server name, shown as a hint. */
  serverExample?: string;
}

export const EXCHANGE_CATALOG: Record<ExchangeId, ExchangeInfo> = {
  BINANCE: {
    id: "BINANCE",
    kind: "API_KEY",
    name: "Binance",
    product: "USDⓈ-M Futures",
    needsPassphrase: false,
    apiManagementUrl: "https://www.binance.com/en/my/settings/api-management",
    historyLimitNote: null,
  },
  MEXC: {
    id: "MEXC",
    kind: "API_KEY",
    name: "MEXC",
    product: "USDT-M Futures",
    needsPassphrase: false,
    apiManagementUrl: "https://www.mexc.com/user/openapi",
    historyLimitNote: null,
  },
  KUCOIN: {
    id: "KUCOIN",
    kind: "API_KEY",
    name: "KuCoin",
    product: "Futures",
    needsPassphrase: true,
    apiManagementUrl: "https://www.kucoin.com/account/api",
    historyLimitNote: "KuCoin's API returns only the last 3 months of futures trades.",
  },
  BINGX: {
    id: "BINGX",
    kind: "API_KEY",
    name: "BingX",
    product: "Perpetual Futures",
    needsPassphrase: false,
    apiManagementUrl: "https://bingx.com/en/accounts/api",
    historyLimitNote: null,
  },
  EXNESS: {
    id: "EXNESS",
    name: "Exness",
    kind: "METATRADER",
    product: "MetaTrader 5 / 4",
    needsPassphrase: false,
    apiManagementUrl: "https://my.exness.com/",
    historyLimitNote: "We import your last 12 months of Exness trades.",
    serverExample: "Exness-MT5Real8",
  },
};

/** Exchanges users can connect today. Must match the adapter registry in @atc/exchange-adapters. */
export const CONNECTABLE_EXCHANGES = EXCHANGE_IDS;
export type ConnectableExchange = ExchangeId;

export function isExchangeId(value: unknown): value is ExchangeId {
  return typeof value === "string" && (EXCHANGE_IDS as readonly string[]).includes(value);
}

// API keys are printable ASCII without whitespace; bounds cover all supported exchanges.
const keyMaterial = z
  .string()
  .trim()
  .min(16, "This looks too short. Copy the whole value.")
  .max(256)
  .regex(/^[\x21-\x7e]+$/, "Remove spaces or line breaks.");

// Passphrases are chosen by the user, so they are never trimmed or reshaped.
const passphrase = z
  .string()
  .min(1, "Enter the passphrase you set when creating this key.")
  .max(128)
  .regex(/^[\x21-\x7e]+$/, "Passphrases cannot contain spaces or line breaks.");

export const credentialsSchema = z
  .object({ apiKey: keyMaterial, apiSecret: keyMaterial, passphrase: passphrase.optional() })
  .strict();

/** MetaTrader login: the account number. */
const mtLogin = z
  .string()
  .trim()
  .regex(/^\d{4,15}$/, "Enter the account number (digits only), e.g. 81234567.");
/** The investor (read-only) password, used once to connect and never kept after that. */
const mtPassword = z
  .string()
  .min(4, "Enter the investor password.")
  .max(64)
  .regex(/^[^\s]+$/, "Passwords cannot contain spaces or line breaks.");
const mtServer = z
  .string()
  .trim()
  .min(3, "Enter the server name, e.g. Exness-MT5Real8.")
  .max(64)
  .regex(/^[A-Za-z0-9 ._-]+$/, "Use the server name exactly as your broker shows it.");
const mtPlatform = z.enum(["mt5", "mt4"], { message: "Choose MetaTrader 5 or MetaTrader 4." });

export const metatraderCredentialsSchema = z
  .object({ login: mtLogin, password: mtPassword, server: mtServer, platform: mtPlatform })
  .strict();
export type MetatraderCredentialsInput = z.infer<typeof metatraderCredentialsSchema>;

const label = z.string().trim().min(1, "Give this connection a name.").max(40);

const apiKeyConnectSchema = z
  .object({
    exchange: z.enum(["BINANCE", "MEXC", "KUCOIN", "BINGX"]),
    label,
    apiKey: keyMaterial,
    apiSecret: keyMaterial,
    passphrase: passphrase.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const info = EXCHANGE_CATALOG[value.exchange];
    if (info.needsPassphrase && !value.passphrase) {
      ctx.addIssue({
        code: "custom",
        path: ["passphrase"],
        message: `${info.name} keys need the passphrase you set when creating the key.`,
      });
    }
    if (!info.needsPassphrase && value.passphrase !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["passphrase"],
        message: `${info.name} keys have no passphrase.`,
      });
    }
  });

const metatraderConnectSchema = z
  .object({
    exchange: z.literal("EXNESS"),
    label,
    login: mtLogin,
    password: mtPassword,
    server: mtServer,
    platform: mtPlatform,
  })
  .strict();

export const connectExchangeSchema = z.discriminatedUnion("exchange", [
  apiKeyConnectSchema,
  metatraderConnectSchema,
]);

export type ConnectExchangeInput = z.infer<typeof connectExchangeSchema>;
export type ApiKeyConnectInput = z.infer<typeof apiKeyConnectSchema>;
export type MetatraderConnectInput = z.infer<typeof metatraderConnectSchema>;
export type CredentialsInput = z.infer<typeof credentialsSchema>;

export interface ExchangeAccountDto {
  id: string;
  exchange: ExchangeId;
  label: string;
  /** CONNECTING: a MetaTrader account is being logged in (takes a few minutes). */
  status: "CONNECTING" | "ACTIVE" | "INVALID" | "DISCONNECTED";
  apiKeyHint: string;
  /** null when the exchange does not report whether the key is IP-restricted. */
  ipRestricted: boolean | null;
  /** When the exchange will expire this key (MEXC keys without an IP whitelist expire). */
  keyExpiresAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  createdAt: string;
  sync: {
    /** SYNCING while a download is running; PENDING before the first download has finished. */
    state: "PENDING" | "SYNCING" | "IDLE";
    lastSyncedAt: string | null;
    /** Earliest trade date we could download from the exchange. */
    historyStartsAt: string | null;
    backfillCompletedAt: string | null;
  };
}

export interface ExchangeAccountsResponse {
  accounts: ExchangeAccountDto[];
  /** Our servers' outbound IPs, for users to whitelist on the exchange. Empty if not configured. */
  egressIps: string[];
  /** Crypto exchange connections (API keys). Exness is counted separately in `brokers`. -1 = unlimited. */
  limit: { used: number; max: number };
  /** MetaTrader (Exness) connections; each runs a paid cloud terminal. -1 = unlimited. */
  brokers: { used: number; max: number };
}
