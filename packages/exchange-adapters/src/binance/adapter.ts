import { failure } from "../messages.js";
import { firstProblem } from "../permissions.js";
import {
  type ApiCredentials,
  type ExchangeAdapter,
  ExchangeHttpError,
  type VerificationFailure,
  type VerificationResult,
} from "../types.js";
import { BinanceClient, type BinanceClientOptions } from "./client.js";
import { evaluateBinanceRestrictions } from "./permissions.js";

type Stage = "restrictions" | "account" | "futures";

export class BinanceAdapter implements ExchangeAdapter {
  readonly id = "BINANCE" as const;

  constructor(private readonly options: BinanceClientOptions = {}) {}

  async verifyCredentials(credentials: ApiCredentials): Promise<VerificationResult> {
    const client = new BinanceClient(credentials, this.options);
    let stage: Stage = "restrictions";
    try {
      const restrictions = await client.signedGet<Record<string, unknown>>(
        "spot",
        "/sapi/v1/account/apiRestrictions",
      );
      const evaluation = evaluateBinanceRestrictions(restrictions);
      const problem = firstProblem(evaluation);
      if (problem) return failure(this.id, problem.code, problem.details);

      stage = "account";
      const account = await client.signedGet<{ uid?: number | string }>("spot", "/api/v3/account", {
        omitZeroBalances: true,
      });

      stage = "futures";
      await client.signedGet<unknown[]>("futures", "/fapi/v1/income", { limit: 1 });

      return {
        ok: true,
        externalAccountId: account.uid === undefined ? null : String(account.uid),
        ipRestricted: evaluation.snapshot.ipRestrict === true,
        keyExpiresAt: null,
        permissions: evaluation.snapshot,
      };
    } catch (err) {
      return mapBinanceFailure(err, stage);
    }
  }
}

export function mapBinanceFailure(err: unknown, stage: Stage): VerificationFailure {
  if (err instanceof ExchangeHttpError) {
    if (err.status === 451 || /restricted location/i.test(err.exchangeMessage)) {
      return failure("BINANCE", "RESTRICTED_LOCATION");
    }
    if (err.status === 429 || err.status === 418) return failure("BINANCE", "RATE_LIMITED");
    if (err.exchangeCode === -1022) return failure("BINANCE", "INVALID_SECRET");
    if (
      stage === "futures" &&
      (err.exchangeCode === -2015 || err.status === 401 || err.status === 403)
    ) {
      return failure("BINANCE", "FUTURES_UNAVAILABLE");
    }
    // -2015 covers a wrong key, a non-whitelisted IP and missing permissions; the message explains all.
    if (err.exchangeCode === -2014 || err.exchangeCode === -2015 || err.status === 401) {
      return failure("BINANCE", "INVALID_KEY");
    }
  }
  return failure("BINANCE", "EXCHANGE_UNAVAILABLE");
}
