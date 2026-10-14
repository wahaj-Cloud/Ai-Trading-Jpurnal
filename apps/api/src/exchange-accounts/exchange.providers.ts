import { CredentialVault, loadKeyRing } from "@atc/crypto";
import { type AdapterRegistry, createAdapterRegistry } from "@atc/exchange-adapters";
import type { Provider } from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";

export const CREDENTIAL_VAULT = Symbol("CREDENTIAL_VAULT");
export const EXCHANGE_ADAPTERS = Symbol("EXCHANGE_ADAPTERS");
export type { AdapterRegistry };

export const credentialVaultProvider: Provider<CredentialVault> = {
  provide: CREDENTIAL_VAULT,
  inject: [ENV],
  // Parsed at boot: a misconfigured key ring stops the deploy instead of failing on first connect.
  useFactory: async (env: Env) =>
    new CredentialVault(
      await loadKeyRing({
        plain: env.CREDENTIAL_KEYS,
        kms: env.CREDENTIAL_KEYS_KMS,
        activeKeyId: env.CREDENTIAL_ACTIVE_KEY_ID,
      }),
    ),
};

export const exchangeAdaptersProvider: Provider<AdapterRegistry> = {
  provide: EXCHANGE_ADAPTERS,
  inject: [ENV],
  useFactory: (env: Env) =>
    createAdapterRegistry({
      binance: {
        spotBaseUrl: env.BINANCE_SPOT_BASE_URL,
        futuresBaseUrl: env.BINANCE_FUTURES_BASE_URL,
      },
      mexc: { baseUrl: env.MEXC_BASE_URL },
      kucoin: {
        spotBaseUrl: env.KUCOIN_SPOT_BASE_URL,
        futuresBaseUrl: env.KUCOIN_FUTURES_BASE_URL,
      },
      bingx: { baseUrl: env.BINGX_BASE_URL },
      bybit: { baseUrl: env.BYBIT_BASE_URL },
      okx: { baseUrl: env.OKX_BASE_URL },
    }),
};
