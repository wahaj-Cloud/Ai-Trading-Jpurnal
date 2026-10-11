import { EXCHANGE_IDS } from "@atc/shared";
import { BinanceAdapter } from "./binance/adapter.js";
import type { BinanceClientOptions } from "./binance/client.js";
import { BinanceHistorySource } from "./binance/history.js";
import { BingxAdapter } from "./bingx/adapter.js";
import type { BingxClientOptions } from "./bingx/client.js";
import { BingxHistorySource } from "./bingx/history.js";
import type { HistorySource } from "./history/types.js";
import { KucoinAdapter } from "./kucoin/adapter.js";
import type { KucoinClientOptions } from "./kucoin/client.js";
import { KucoinHistorySource } from "./kucoin/history.js";
import { MetatraderAdapter } from "./metatrader/adapter.js";
import { MetatraderHistorySource } from "./metatrader/history.js";
import type { MetaApiOptions } from "./metatrader/metaapi.js";
import { MexcAdapter } from "./mexc/adapter.js";
import type { MexcClientOptions } from "./mexc/client.js";
import { MexcHistorySource } from "./mexc/history.js";
import type { ApiCredentials, ClientOptions, ExchangeAdapter, ExchangeId } from "./types.js";

export interface AdapterConfig {
  binance?: BinanceClientOptions;
  mexc?: MexcClientOptions;
  kucoin?: KucoinClientOptions;
  bingx?: BingxClientOptions;
  /** MetaTrader brokers (Exness) through MetaApi. */
  metaapi?: MetaApiOptions;
}

/** Every exchange in the shared catalog has an adapter; the type system enforces it. */
export const SUPPORTED_EXCHANGES = EXCHANGE_IDS;
export type SupportedExchange = ExchangeId;
export type AdapterRegistry = Record<ExchangeId, ExchangeAdapter>;

export function createAdapterRegistry(config: AdapterConfig = {}): AdapterRegistry {
  return {
    BINANCE: new BinanceAdapter(config.binance),
    MEXC: new MexcAdapter(config.mexc),
    KUCOIN: new KucoinAdapter(config.kucoin),
    BINGX: new BingxAdapter(config.bingx),
    EXNESS: new MetatraderAdapter(config.metaapi),
  };
}

/**
 * History download for one account. `shared` options (rate limiter, fetch, clock) apply to every
 * exchange and are layered over the per-exchange config (base URLs).
 */
export function createHistorySource(
  exchange: ExchangeId,
  credentials: ApiCredentials,
  config: AdapterConfig = {},
  shared: ClientOptions = {},
): HistorySource {
  switch (exchange) {
    case "BINANCE":
      return new BinanceHistorySource(credentials, { ...config.binance, ...shared });
    case "MEXC":
      return new MexcHistorySource(credentials, { ...config.mexc, ...shared });
    case "KUCOIN":
      return new KucoinHistorySource(credentials, { ...config.kucoin, ...shared });
    case "BINGX":
      return new BingxHistorySource(credentials, { ...config.bingx, ...shared });
    case "EXNESS":
      return new MetatraderHistorySource(credentials, { ...config.metaapi, ...shared });
  }
}
