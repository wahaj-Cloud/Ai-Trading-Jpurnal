import type { ExchangeId } from "@atc/shared";

export type { ExchangeId };

export interface ApiCredentials {
  apiKey: string;
  apiSecret: string;
  /** Required by KuCoin; ignored by exchanges without passphrases. */
  passphrase?: string;
}

export type VerificationFailureCode =
  | "INVALID_KEY"
  | "INVALID_SECRET"
  | "INVALID_PASSPHRASE"
  | "IP_NOT_ALLOWED" // key is locked to IPs that do not include our servers
  | "KEY_EXPIRED" // expired, frozen or deleted on the exchange
  | "MISSING_PERMISSIONS" // a read permission we need is off
  | "UNSAFE_PERMISSIONS" // key can trade, withdraw or transfer
  | "FUTURES_UNAVAILABLE"
  | "ACCOUNT_RESTRICTED" // the exchange restricts this user's account (region, KYC, frozen)
  | "RATE_LIMITED"
  | "RESTRICTED_LOCATION" // exchange blocks our server region: an ops problem, not the user's
  | "UNVERIFIABLE_PERMISSIONS" // exchange response lacks a permission we must see to prove safety
  | "EXCHANGE_UNAVAILABLE";

export interface VerifiedKey {
  ok: true;
  /** The exchange's own account ID, used to stop a reconnect from switching accounts. */
  externalAccountId: string | null;
  /** null when the exchange does not report IP restrictions. */
  ipRestricted: boolean | null;
  /** Set when the exchange will expire this key (e.g. MEXC keys without an IP whitelist). */
  keyExpiresAt: Date | null;
  /** Snapshot of the permissions reported by the exchange, for audit and support. */
  permissions: Record<string, boolean>;
}

export interface VerificationFailure {
  ok: false;
  code: VerificationFailureCode;
  message: string;
  details?: string[];
}

export type VerificationResult = VerifiedKey | VerificationFailure;

export interface ExchangeAdapter {
  readonly id: ExchangeId;
  verifyCredentials(credentials: ApiCredentials): Promise<VerificationResult>;
}

/**
 * Raised by exchange HTTP clients for HTTP errors and for error payloads sent with HTTP 200.
 * Never contains credentials or signed URLs.
 */
export class ExchangeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly exchangeCode: number | string | null,
    readonly exchangeMessage: string,
  ) {
    super(
      `Exchange request failed (${status}${exchangeCode === null ? "" : `, ${exchangeCode}`}): ${exchangeMessage}`,
    );
    this.name = "ExchangeHttpError";
  }
}

export class ExchangeNetworkError extends Error {
  constructor(cause: unknown) {
    super("Exchange could not be reached", { cause });
    this.name = "ExchangeNetworkError";
  }
}

/** Options every exchange client accepts; base URLs are overridable for testnets and tests. */
export interface ClientOptions {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  /**
   * Awaited before every request to the exchange. The sync worker plugs a shared rate limiter in
   * here, so all users' traffic together stays inside each exchange's limits.
   */
  beforeRequest?: (url: URL) => Promise<void>;
}
