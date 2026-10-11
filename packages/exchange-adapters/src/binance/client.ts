import { hmacSha256Hex, joinParams, type Params, resolveFetch, send } from "../http.js";
import { type ApiCredentials, type ClientOptions, ExchangeHttpError } from "../types.js";

export interface BinanceClientOptions extends ClientOptions {
  spotBaseUrl?: string;
  futuresBaseUrl?: string;
  recvWindowMs?: number;
}

type Market = "spot" | "futures";

/**
 * Minimal signed REST client for Binance spot/SAPI and USDⓈ-M futures.
 * Corrects for clock drift using Binance server time, fetched once per client.
 */
export class BinanceClient {
  private readonly baseUrls: Record<Market, string>;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly recvWindowMs: number;
  private readonly timeoutMs: number;
  private clockOffsetMs: Promise<number> | undefined;

  constructor(
    private readonly credentials: ApiCredentials,
    options: BinanceClientOptions = {},
  ) {
    this.baseUrls = {
      spot: options.spotBaseUrl ?? "https://api.binance.com",
      futures: options.futuresBaseUrl ?? "https://fapi.binance.com",
    };
    this.fetchFn = resolveFetch(options);
    this.now = options.now ?? Date.now;
    this.recvWindowMs = options.recvWindowMs ?? 10_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async signedGet<T>(market: Market, path: string, params: Params = {}): Promise<T> {
    const timestamp = this.now() + (await this.offset());
    const query = joinParams({ ...params, recvWindow: this.recvWindowMs, timestamp });
    const signature = hmacSha256Hex(this.credentials.apiSecret, query);
    return this.request<T>(`${this.baseUrls[market]}${path}?${query}&signature=${signature}`, {
      "X-MBX-APIKEY": this.credentials.apiKey,
    });
  }

  /** Local clock (how far a sync run reaches); signing uses the exchange-corrected time. */
  nowMs(): number {
    return this.now();
  }

  /** Unsigned market-data request (no API key sent). */
  publicGet<T>(market: Market, path: string, params: Params = {}): Promise<T> {
    return this.request<T>(`${this.baseUrls[market]}${path}?${joinParams(params)}`, {});
  }

  private offset(): Promise<number> {
    this.clockOffsetMs ??= this.request<{ serverTime: number }>(
      `${this.baseUrls.spot}/api/v3/time`,
      {},
    )
      .then((r) => r.serverTime - this.now())
      .catch((err: unknown) => {
        this.clockOffsetMs = undefined; // allow a retry on the next call
        throw err;
      });
    return this.clockOffsetMs;
  }

  private async request<T>(url: string, headers: Record<string, string>): Promise<T> {
    const res = await send(this.fetchFn, url, { headers, timeoutMs: this.timeoutMs });
    if (!res.ok) {
      const code = typeof res.json?.code === "number" ? res.json.code : null;
      const msg = typeof res.json?.msg === "string" ? res.json.msg : res.text.slice(0, 200);
      throw new ExchangeHttpError(res.status, code, msg);
    }
    return (res.json ?? JSON.parse(res.text)) as T;
  }
}
