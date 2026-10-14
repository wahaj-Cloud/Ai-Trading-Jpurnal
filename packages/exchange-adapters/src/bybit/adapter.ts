import { failure } from "../messages.js";
import {
  type ApiCredentials,
  type ExchangeAdapter,
  ExchangeHttpError,
  type VerificationFailure,
  type VerificationResult,
} from "../types.js";
import { BybitClient, type BybitClientOptions } from "./client.js";

type Stage = "keyInfo" | "futures";

/** GET /v5/user/query-api */
export interface BybitKeyInfo {
  /** 1 = read-only, 0 = read and write. */
  readOnly?: number;
  permissions?: Record<string, string[] | undefined>;
  ips?: string[];
  expiredAt?: string;
  userID?: number | string;
  uta?: number;
}

/** Labels match the permission groups on Bybit's API management page. */
const GROUP_LABELS: Record<string, string> = {
  ContractTrade: "Contracts (Orders & Positions)",
  Derivatives: "Unified Trading (Derivatives)",
  Spot: "Spot Trading",
  Wallet: "Wallet",
  Options: "USDC Contracts / Options",
  Exchange: "Convert",
  Earn: "Earn",
  CopyTrading: "Copy Trading",
  BlockTrade: "Block Trade",
  NFT: "NFT",
};

/**
 * Read-only check for a Bybit key. A key is safe only when Bybit reports it as read-only and it
 * has no withdrawal or transfer permission; it must be able to read contract orders and positions.
 */
export function evaluateBybitKey(info: BybitKeyInfo): {
  problem: {
    code: "UNSAFE_PERMISSIONS" | "MISSING_PERMISSIONS" | "UNVERIFIABLE_PERMISSIONS";
    details: string[];
  } | null;
  snapshot: Record<string, boolean>;
} {
  const perms = info.permissions;
  const snapshot: Record<string, boolean> = { readOnly: info.readOnly === 1 };
  for (const [group, list] of Object.entries(perms ?? {})) {
    for (const p of list ?? []) snapshot[`${group}.${p}`] = true;
  }
  if (info.readOnly === undefined || perms === undefined) {
    return { problem: { code: "UNVERIFIABLE_PERMISSIONS", details: ["readOnly"] }, snapshot };
  }
  const wallet = perms.Wallet ?? [];
  if (info.readOnly !== 1 || wallet.length > 0) {
    const granted = Object.entries(perms)
      .filter(([, list]) => (list ?? []).length > 0)
      .map(([g]) => GROUP_LABELS[g] ?? g);
    const details = [
      ...(info.readOnly !== 1 ? ["Read-Write (choose Read-Only)"] : []),
      ...(wallet.includes("Withdraw")
        ? ["Withdrawal"]
        : wallet.length > 0
          ? ["Wallet transfers"]
          : []),
      ...(info.readOnly !== 1 ? granted.filter((g) => g !== "Wallet") : []),
    ];
    return { problem: { code: "UNSAFE_PERMISSIONS", details: [...new Set(details)] }, snapshot };
  }
  const canReadContracts =
    (perms.ContractTrade ?? []).length > 0 || (perms.Derivatives ?? []).length > 0;
  if (!canReadContracts) {
    return {
      problem: { code: "MISSING_PERMISSIONS", details: ["Contracts (Orders & Positions)"] },
      snapshot,
    };
  }
  return { problem: null, snapshot };
}

export class BybitAdapter implements ExchangeAdapter {
  readonly id = "BYBIT" as const;

  constructor(private readonly options: BybitClientOptions = {}) {}

  async verifyCredentials(credentials: ApiCredentials): Promise<VerificationResult> {
    const client = new BybitClient(credentials, this.options);
    let stage: Stage = "keyInfo";
    try {
      const info = await client.get<BybitKeyInfo>("/v5/user/query-api");
      const { problem, snapshot } = evaluateBybitKey(info ?? {});
      if (problem) return failure(this.id, problem.code, problem.details);

      stage = "futures";
      await client.get<unknown>("/v5/position/list", {
        category: "linear",
        settleCoin: "USDT",
        limit: 1,
      });

      const ips = (info.ips ?? []).filter((ip) => ip && ip !== "*");
      const expires = info.expiredAt ? new Date(info.expiredAt) : null;
      return {
        ok: true,
        externalAccountId: info.userID === undefined ? null : String(info.userID),
        ipRestricted: info.ips ? ips.length > 0 : null,
        // Keys without a bound IP expire (Bybit shows the date); IP-bound keys do not.
        keyExpiresAt:
          expires && !Number.isNaN(expires.getTime()) && ips.length === 0 ? expires : null,
        permissions: snapshot,
      };
    } catch (err) {
      return mapBybitFailure(err, stage);
    }
  }
}

export function mapBybitFailure(err: unknown, stage: Stage): VerificationFailure {
  if (err instanceof ExchangeHttpError) {
    const code = err.exchangeCode;
    if (err.status === 429 || code === 10006 || code === 10018)
      return failure("BYBIT", "RATE_LIMITED");
    // A 403 without a Bybit error body is Bybit's CDN refusing our server's country.
    if (err.status === 403 && code === null) return failure("BYBIT", "RESTRICTED_LOCATION");
    if (code === 10003) return failure("BYBIT", "INVALID_KEY");
    if (code === 10004) return failure("BYBIT", "INVALID_SECRET");
    if (code === 10010) return failure("BYBIT", "IP_NOT_ALLOWED");
    if (code === 33004) return failure("BYBIT", "KEY_EXPIRED");
    if (code === 10024 || code === 10027) return failure("BYBIT", "ACCOUNT_RESTRICTED");
    if (code === 10005) {
      return stage === "futures"
        ? failure("BYBIT", "MISSING_PERMISSIONS", ["Contracts (Orders & Positions)"])
        : failure("BYBIT", "MISSING_PERMISSIONS");
    }
  }
  // Includes clock-skew errors (10002): our problem, not the user's.
  return failure("BYBIT", "EXCHANGE_UNAVAILABLE");
}
