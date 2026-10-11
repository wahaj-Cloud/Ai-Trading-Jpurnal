import { hmacSha256Hex, joinParams, type Params, resolveFetch, send, sortParams } from "../http.js";
import { type ApiCredentials, type ClientOptions, ExchangeHttpError } from "../types.js";

export interface MexcClientOptions extends ClientOptions {
  baseUrl?: string;
  recvWindowMs?: number;
}

/**
 * Signed REST client for MEXC.
 *  - Spot v3 (/api/v3/*): HMAC-SHA256 hex of the query string, X-MEXC-APIKEY header.
 *  - Futures (/api/v1/private/*): HMAC-SHA256 hex of apiKey + timestamp + sorted query,
 *    sent in ApiKey / Request-Time / Signature headers; errors arrive as HTTP 200 with success=false.
 */
export class MexcClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly recvWindowMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly credentials: ApiCredentials,
    options: MexcClientOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? "https://api.mexc.com";
    this.fetchFn = resolveFetch(options);
    this.now = options.now ?? Date.now;
    this.recvWindowMs = options.recvWindowMs ?? 10_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async spotGet<T>(path: string, params: Params = {}): Promise<T> {
    const query = joinParams({ ...params, recvWindow: this.recvWindowMs, timestamp: this.now() });
    const signature = hmacSha256Hex(this.credentials.apiSecret, query);
    const res = await send(this.fetchFn, `${this.baseUrl}${path}?${query}&signature=${signature}`, {
      headers: { "X-MEXC-APIKEY": this.credentials.apiKey },
      timeoutMs: this.timeoutMs,
    });
    if (!res.ok) {
      throw new ExchangeHttpError(
        res.status,
        typeof res.json?.code === "number" ? res.json.code : null,
        typeof res.json?.msg === "string" ? res.json.msg : res.text.slice(0, 200),
      );
    }
    return res.json as T;
  }

  async futuresGet<T>(path: string, params: Params = {}): Promise<T> {
    const query = joinParams(sortParams(params));
    const timestamp = String(this.now());
    const signature = hmacSha256Hex(
      this.credentials.apiSecret,
      `${this.credentials.apiKey}${timestamp}${query}`,
    );
    return this.futuresRequest<T>(path, query, {
      ApiKey: this.credentials.apiKey,
      "Request-Time": timestamp,
      "Recv-Window": String(this.recvWindowMs),
      Signature: signature,
      "Content-Type": "application/json",
    });
  }

  /** Unauthenticated futures market data (e.g. contract sizes). */
  async futuresPublicGet<T>(path: string, params: Params = {}): Promise<T> {
    return this.futuresRequest<T>(path, joinParams(params), {});
  }

  private async futuresRequest<T>(
    path: string,
    query: string,
    headers: Record<string, string>,
  ): Promise<T> {
    const res = await send(this.fetchFn, `${this.baseUrl}${path}${query ? `?${query}` : ""}`, {
      headers,
      timeoutMs: this.timeoutMs,
    });
    const code =
      typeof res.json?.code === "number" ? res.json.code : Number(res.json?.code ?? Number.NaN);
    const failed = !res.ok || res.json?.success === false || (Number.isFinite(code) && code !== 0);
    if (failed) {
      throw new ExchangeHttpError(
        res.status,
        Number.isFinite(code) ? code : null,
        typeof res.json?.message === "string" ? res.json.message : res.text.slice(0, 200),
      );
    }
    return res.json?.data as T;
  }
}
