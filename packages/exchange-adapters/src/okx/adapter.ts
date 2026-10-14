import { failure } from "../messages.js";
import {
  type ApiCredentials,
  type ExchangeAdapter,
  ExchangeHttpError,
  type VerificationFailure,
  type VerificationResult,
} from "../types.js";
import { OkxClient, type OkxClientOptions } from "./client.js";

type Stage = "config" | "futures";

/** GET /api/v5/account/config (first row). */
export interface OkxAccountConfig {
  uid?: string;
  /** Comma-separated permissions of the calling key: read_only, trade, withdraw. */
  perm?: string;
  /** IP addresses bound to the key, comma-separated; empty when none. */
  ip?: string;
}

const LABELS: Record<string, string> = { read_only: "Read", trade: "Trade", withdraw: "Withdraw" };

/** Read-only check: the key must have Read and nothing else. */
export function evaluateOkxPerm(perm: string | undefined): {
  problem: {
    code: "UNSAFE_PERMISSIONS" | "MISSING_PERMISSIONS" | "UNVERIFIABLE_PERMISSIONS";
    details: string[];
  } | null;
  snapshot: Record<string, boolean>;
} {
  if (perm === undefined) {
    return { problem: { code: "UNVERIFIABLE_PERMISSIONS", details: ["perm"] }, snapshot: {} };
  }
  const granted = perm
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const snapshot = Object.fromEntries(granted.map((p) => [p, true]));
  const unsafe = granted.filter((p) => p !== "read_only").map((p) => LABELS[p] ?? p);
  if (unsafe.length > 0)
    return { problem: { code: "UNSAFE_PERMISSIONS", details: unsafe }, snapshot };
  if (!granted.includes("read_only")) {
    return { problem: { code: "MISSING_PERMISSIONS", details: ["Read"] }, snapshot };
  }
  return { problem: null, snapshot };
}

export class OkxAdapter implements ExchangeAdapter {
  readonly id = "OKX" as const;

  constructor(private readonly options: OkxClientOptions = {}) {}

  async verifyCredentials(credentials: ApiCredentials): Promise<VerificationResult> {
    const client = new OkxClient(credentials, this.options);
    let stage: Stage = "config";
    try {
      const [config] = (await client.get<OkxAccountConfig[]>("/api/v5/account/config")) ?? [];
      const { problem, snapshot } = evaluateOkxPerm(config?.perm);
      if (problem) return failure(this.id, problem.code, problem.details);

      stage = "futures";
      await client.get<unknown>("/api/v5/account/positions", { instType: "SWAP" });

      return {
        ok: true,
        externalAccountId: config?.uid || null,
        ipRestricted: config?.ip === undefined ? null : config.ip.trim().length > 0,
        keyExpiresAt: null,
        permissions: snapshot,
      };
    } catch (err) {
      return mapOkxFailure(err, stage);
    }
  }
}

export function mapOkxFailure(err: unknown, stage: Stage): VerificationFailure {
  if (err instanceof ExchangeHttpError) {
    const code = err.exchangeCode === null ? null : String(err.exchangeCode);
    if (err.status === 429 || code === "50011" || code === "50061")
      return failure("OKX", "RATE_LIMITED");
    if (err.status === 403 && code === null) return failure("OKX", "RESTRICTED_LOCATION");
    if (code === "50111" || code === "50119" || code === "50101")
      return failure("OKX", "INVALID_KEY");
    if (code === "50113") return failure("OKX", "INVALID_SECRET");
    if (code === "50105") return failure("OKX", "INVALID_PASSPHRASE");
    if (code === "50110") return failure("OKX", "IP_NOT_ALLOWED");
    if (code === "50100") return failure("OKX", "KEY_EXPIRED");
    if (code === "50120") {
      return failure("OKX", "MISSING_PERMISSIONS", ["Read"]);
    }
    if (code === "50007" || code === "51155" || code === "50125") {
      return failure("OKX", "ACCOUNT_RESTRICTED");
    }
    if (stage === "futures" && code === "51010") return failure("OKX", "FUTURES_UNAVAILABLE");
  }
  // Includes clock-skew errors (50102): our problem, not the user's.
  return failure("OKX", "EXCHANGE_UNAVAILABLE");
}
