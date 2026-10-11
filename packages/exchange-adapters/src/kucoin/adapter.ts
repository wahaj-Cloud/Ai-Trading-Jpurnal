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
import { KucoinClient, type KucoinClientOptions } from "./client.js";

type Stage = "keyInfo" | "futures";

/** Permission names from GET /api/v1/user/api-key, labelled as on KuCoin's API page. */
export const KUCOIN_POLICY = {
  isReadPermission: (p: string) => p === "General",
  required: ["General"],
  labels: {
    General: "General",
    Spot: "Spot Trading",
    Margin: "Margin Trading",
    Futures: "Futures Trading",
    Unified: "Unified Account Trading",
    Earn: "Earn",
    InnerTransfer: "Inner Transfer",
    Withdrawal: "Withdrawal",
  } as Record<string, string>,
} as const;

interface ApiKeyInfo {
  permission?: unknown;
  uid?: unknown;
  ipWhitelist?: unknown;
}

export class KucoinAdapter implements ExchangeAdapter {
  readonly id = "KUCOIN" as const;

  constructor(private readonly options: KucoinClientOptions = {}) {}

  async verifyCredentials(credentials: ApiCredentials): Promise<VerificationResult> {
    if (!credentials.passphrase) return failure(this.id, "INVALID_PASSPHRASE");
    const client = new KucoinClient(
      { ...credentials, passphrase: credentials.passphrase },
      this.options,
    );
    let stage: Stage = "keyInfo";
    try {
      const info = await client.get<ApiKeyInfo>("spot", "/api/v1/user/api-key");
      if (typeof info?.permission !== "string") return failure(this.id, "UNVERIFIABLE_PERMISSIONS");

      const evaluation = evaluateList(info.permission.split(","), KUCOIN_POLICY);
      const problem = firstProblem(evaluation);
      if (problem) return failure(this.id, problem.code, problem.details);

      stage = "futures";
      await client.get<unknown>("futures", "/api/v1/account-overview", { currency: "USDT" });

      return {
        ok: true,
        externalAccountId: stringField(info, "uid"),
        // Reported only by some key versions; unknown otherwise.
        ipRestricted:
          typeof info.ipWhitelist === "string" ? info.ipWhitelist.trim().length > 0 : null,
        keyExpiresAt: null,
        permissions: evaluation.snapshot,
      };
    } catch (err) {
      return mapKucoinFailure(err, stage);
    }
  }
}

export function mapKucoinFailure(err: unknown, stage: Stage): VerificationFailure {
  if (err instanceof ExchangeHttpError) {
    const code = err.exchangeCode;
    if (err.status === 429 || code === "429000") return failure("KUCOIN", "RATE_LIMITED");
    if (code === "400001" || code === "400003") return failure("KUCOIN", "INVALID_KEY");
    if (code === "400004") return failure("KUCOIN", "INVALID_PASSPHRASE");
    if (code === "400005") return failure("KUCOIN", "INVALID_SECRET");
    if (code === "400006") return failure("KUCOIN", "IP_NOT_ALLOWED");
    if (code === "400007") {
      return stage === "keyInfo"
        ? failure("KUCOIN", "MISSING_PERMISSIONS", ["General"])
        : failure("KUCOIN", "FUTURES_UNAVAILABLE");
    }
    if (code === "411100") return failure("KUCOIN", "ACCOUNT_RESTRICTED");
    if (
      err.status === 403 &&
      (code === null || /restrict|region|country|jurisdiction/i.test(err.exchangeMessage))
    ) {
      return failure("KUCOIN", "RESTRICTED_LOCATION");
    }
  }
  // Includes clock-skew errors (400002): our problem, not the user's.
  return failure("KUCOIN", "EXCHANGE_UNAVAILABLE");
}
