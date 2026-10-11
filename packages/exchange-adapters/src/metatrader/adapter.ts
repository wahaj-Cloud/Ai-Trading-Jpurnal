import type { ApiCredentials, ExchangeAdapter, VerificationResult } from "../types.js";
import { classifyMetaApi } from "./history.js";
import { MetaApiClient, type MetaApiOptions } from "./metaapi.js";
import { readOnlyFailure } from "./provision.js";

/**
 * Daily re-check of a connected MetaTrader account: the cloud session must still be logged in with
 * the investor (read-only) password. The first connection is made by the sync worker
 * (see provision.ts), because logging in takes minutes.
 */
export class MetatraderAdapter implements ExchangeAdapter {
  readonly id = "EXNESS" as const;
  private readonly client: MetaApiClient;

  constructor(options: MetaApiOptions = {}) {
    this.client = new MetaApiClient(options);
  }

  async verifyCredentials(credentials: ApiCredentials): Promise<VerificationResult> {
    try {
      const account = await this.client.getAccount(credentials.apiSecret);
      if (account.state !== "DEPLOYED" || account.connectionStatus !== "CONNECTED") {
        return {
          ok: false,
          code: "EXCHANGE_UNAVAILABLE",
          message: "Your MetaTrader account is reconnecting. We will check again shortly.",
        };
      }
      const info = await this.client.accountInformation({
        id: account._id,
        region: account.region,
      });
      const unsafe = readOnlyFailure(info);
      if (unsafe) return unsafe;
      return {
        ok: true,
        externalAccountId: `${String(info.server).toLowerCase()}:${String(info.login)}`,
        ipRestricted: null,
        keyExpiresAt: null,
        permissions: { investorMode: true, tradeAllowed: info.tradeAllowed === true },
      };
    } catch (err) {
      return classifyMetaApi(err);
    }
  }
}
