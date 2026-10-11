import { stringField } from "../http.js";
import { failure } from "../messages.js";
import { evaluateFlags, firstProblem } from "../permissions.js";
import {
  type ApiCredentials,
  type ExchangeAdapter,
  ExchangeHttpError,
  type VerificationFailure,
  type VerificationResult,
} from "../types.js";
import { BingxClient, type BingxClientOptions } from "./client.js";

type Stage = "permissions" | "uid" | "futures";

/** Policy for GET /openApi/v1/account/apiPermissions. Labels match BingX's API settings page. */
export const BINGX_POLICY = {
  readFlags: new Set(["enableReading"]),
  requiredFlags: ["enableReading"],
  mustReport: ["enableReading", "enableWithdrawals", "enableFutures", "enableSpotAndMarginTrading"],
  ignoreFlags: new Set(["ipRestrict"]),
  labels: {
    enableReading: "Read",
    enableSpotAndMarginTrading: "Spot Trading",
    enableFutures: "Perpetual Futures Trading",
    enableWithdrawals: "Withdraw",
    permitsUniversalTransfer: "Universal Transfer",
    enableInternalTransfer: "Internal Transfer",
    enableVanillaOptions: "Options Trading",
  } as Record<string, string>,
} as const;

export class BingxAdapter implements ExchangeAdapter {
  readonly id = "BINGX" as const;

  constructor(private readonly options: BingxClientOptions = {}) {}

  async verifyCredentials(credentials: ApiCredentials): Promise<VerificationResult> {
    const client = new BingxClient(credentials, this.options);
    let stage: Stage = "permissions";
    try {
      const flags = await client.get<Record<string, unknown>>("/openApi/v1/account/apiPermissions");
      const evaluation = evaluateFlags(flags ?? {}, BINGX_POLICY);
      const problem = firstProblem(evaluation);
      if (problem) return failure(this.id, problem.code, problem.details);

      stage = "uid";
      const uid = stringField(await client.get<unknown>("/openApi/account/v1/uid"), "uid");

      stage = "futures";
      await client.get<unknown>("/openApi/swap/v3/user/balance");

      return {
        ok: true,
        externalAccountId: uid,
        ipRestricted: evaluation.snapshot.ipRestrict ?? null,
        keyExpiresAt: null,
        permissions: evaluation.snapshot,
      };
    } catch (err) {
      return mapBingxFailure(err, stage);
    }
  }
}

export function mapBingxFailure(err: unknown, stage: Stage): VerificationFailure {
  if (err instanceof ExchangeHttpError) {
    const code = err.exchangeCode;
    if (err.status === 429 || err.status === 418 || code === 100410 || code === 109429) {
      return failure("BINGX", "RATE_LIMITED");
    }
    if (code === 100001) return failure("BINGX", "INVALID_SECRET");
    if (code === 100413) return failure("BINGX", "INVALID_KEY");
    if (code === 100419) return failure("BINGX", "IP_NOT_ALLOWED");
    if (code === 101210 || code === 101484) return failure("BINGX", "ACCOUNT_RESTRICTED");
    if (code === 100004) {
      return stage === "futures"
        ? failure("BINGX", "FUTURES_UNAVAILABLE")
        : failure("BINGX", "MISSING_PERMISSIONS", ["Read"]);
    }
  }
  // Includes clock-skew errors (100421): our problem, not the user's.
  return failure("BINGX", "EXCHANGE_UNAVAILABLE");
}
