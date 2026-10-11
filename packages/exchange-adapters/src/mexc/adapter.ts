import { stringField } from "../http.js";
import { failure } from "../messages.js";
import { evaluateList, firstProblem } from "../permissions.js";
import {
  type ApiCredentials,
  type ExchangeAdapter,
  ExchangeHttpError,
  type VerificationFailure,
  type VerificationResult,
} from "../types.js";
import { MexcClient, type MexcClientOptions } from "./client.js";

type Stage = "keyInfo" | "uid" | "futures";

const DAY_MS = 86_400_000;
const PERMANENT = -999;

/** Permission codes from GET /api/v3/apiKeyInfo, with the plain meaning shown to users. */
const LABELS: Record<string, string> = {
  SPOT_ACCOUNT_READ: "View spot account (SPOT_ACCOUNT_READ)",
  SPOT_ACCOUNT_WRITE: "Spot account changes (SPOT_ACCOUNT_WRITE)",
  SPOT_DEAL_READ: "View spot orders (SPOT_DEAL_READ)",
  SPOT_DEAL_WRITE: "Spot trading (SPOT_DEAL_WRITE)",
  CONTRACT_ACCOUNT_READ: "View futures account (CONTRACT_ACCOUNT_READ)",
  CONTRACT_ACCOUNT_WRITE: "Futures account changes (CONTRACT_ACCOUNT_WRITE)",
  CONTRACT_DEAL_READ: "View futures orders (CONTRACT_DEAL_READ)",
  CONTRACT_DEAL_WRITE: "Futures trading (CONTRACT_DEAL_WRITE)",
  SPOT_TRANSFER_READ: "View transfers (SPOT_TRANSFER_READ)",
  SPOT_TRANSFER_WRITE: "Transfers (SPOT_TRANSFER_WRITE)",
  SPOT_WITHDRAW_READ: "View withdrawals (SPOT_WITHDRAW_READ)",
  SPOT_WITHDRAW_WRITE: "Withdrawals (SPOT_WITHDRAW_WRITE)",
};

export const MEXC_POLICY = {
  isReadPermission: (p: string) => /^[A-Z_]+_READ$/.test(p),
  required: ["SPOT_ACCOUNT_READ", "CONTRACT_ACCOUNT_READ", "CONTRACT_DEAL_READ"],
  labels: LABELS,
} as const;

interface ApiKeyInfo {
  status?: string;
  permissions?: unknown;
  ipWhiteList?: unknown;
  remainingValidity?: unknown;
}

export class MexcAdapter implements ExchangeAdapter {
  readonly id = "MEXC" as const;

  constructor(private readonly options: MexcClientOptions = {}) {}

  async verifyCredentials(credentials: ApiCredentials): Promise<VerificationResult> {
    const client = new MexcClient(credentials, this.options);
    const now = this.options.now ?? Date.now;
    let stage: Stage = "keyInfo";
    try {
      const info = await client.spotGet<ApiKeyInfo>("/api/v3/apiKeyInfo", {
        accessKey: credentials.apiKey,
      });

      if (typeof info.status === "string" && info.status !== "VALID")
        return failure(this.id, "KEY_EXPIRED");
      const validityDays = Number(info.remainingValidity);
      if (validityDays === 0) return failure(this.id, "KEY_EXPIRED");

      // Fail closed: without the permission list we cannot prove the key is read-only.
      if (typeof info.permissions !== "string") return failure(this.id, "UNVERIFIABLE_PERMISSIONS");
      const evaluation = evaluateList(info.permissions.split(","), MEXC_POLICY);
      const problem = firstProblem(evaluation);
      if (problem) return failure(this.id, problem.code, problem.details);

      stage = "uid";
      const uid = stringField(await client.spotGet<unknown>("/api/v3/uid"), "uid");

      stage = "futures";
      await client.futuresGet<unknown>("/api/v1/private/account/assets");

      const whitelist = typeof info.ipWhiteList === "string" ? info.ipWhiteList.trim() : "";
      return {
        ok: true,
        externalAccountId: uid,
        ipRestricted: whitelist.length > 0,
        keyExpiresAt:
          Number.isFinite(validityDays) && validityDays > 0 && validityDays !== PERMANENT
            ? new Date(now() + validityDays * DAY_MS)
            : null,
        permissions: evaluation.snapshot,
      };
    } catch (err) {
      return mapMexcFailure(err, stage);
    }
  }
}

export function mapMexcFailure(err: unknown, stage: Stage): VerificationFailure {
  if (err instanceof ExchangeHttpError) {
    const code = err.exchangeCode;
    if (err.status === 429 || code === 429 || code === 510) return failure("MEXC", "RATE_LIMITED");
    if (err.status === 403 && err.exchangeCode === null)
      return failure("MEXC", "RESTRICTED_LOCATION");
    // Spot v3 codes
    if (code === 10072 || code === 10073) return failure("MEXC", "INVALID_KEY");
    if (code === 700002) return failure("MEXC", "INVALID_SECRET");
    if (code === 700006) return failure("MEXC", "IP_NOT_ALLOWED");
    if (code === 700007) {
      return stage === "keyInfo"
        ? failure("MEXC", "MISSING_PERMISSIONS", [LABELS.SPOT_ACCOUNT_READ as string])
        : failure("MEXC", "FUTURES_UNAVAILABLE");
    }
    // Futures codes
    if (code === 602) return failure("MEXC", "INVALID_SECRET");
    if (code === 406) return failure("MEXC", "IP_NOT_ALLOWED");
    if (code === 402) return failure("MEXC", "KEY_EXPIRED");
    if (stage === "futures" && code === 401) return failure("MEXC", "FUTURES_UNAVAILABLE");
  }
  // Includes clock-skew errors (700003): our problem, not the user's.
  return failure("MEXC", "EXCHANGE_UNAVAILABLE");
}
