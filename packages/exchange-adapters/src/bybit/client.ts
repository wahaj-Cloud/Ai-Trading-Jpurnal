import { hmacSha256Hex, joinParams, type Params, resolveFetch, send } from "../http.js";
import { type ApiCredentials, type ClientOptions, ExchangeHttpError } from "../types.js";

export interface BybitClientOptions extends ClientOptions {
  baseUrl?: string;
  /** How long Bybit accepts a signed request after its timestamp (ms). */
  recvWindow?: number;
}

/**
 * Signed REST client for Bybit V5.
 * Signature: HMAC-SHA256 hex of timestamp + apiKey + recvWindow + the exact query string sent.
 * Errors usually arrive as HTTP 200 with a non-zero `retCode`.
 */
export class BybitClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly recvWindow: number;

  constructor(
    private readonly credentials: ApiCredentials,
    options: BybitClientOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? "https://api.bybit.com";
    this.fetchFn = resolveFetch(options);
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.recvWindow = options.recvWindow ?? 10_000;
  }

  async get<T>(path: string, params: Params = {}): Promise<T> {
    const query = joinParams(params);
    const timestamp = String(this.now());
    const recv = String(this.recvWindow);
    const signature = hmacSha256Hex(
      this.credentials.apiSecret,
      `${timestamp}${this.credentials.apiKey}${recv}${query}`,
    );
    const res = await send(this.fetchFn, `${this.baseUrl}${path}${query ? `?${query}` : ""}`, {
      headers: {
        "X-BAPI-API-KEY": this.credentials.apiKey,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recv,
        "X-BAPI-SIGN": signature,
      },
      timeoutMs: this.timeoutMs,
    });
    const raw = res.json?.retCode;
    const code = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : null;
    if (!res.ok || code !== 0) {
      throw new ExchangeHttpError(
        res.status,
        code,
        typeof res.json?.retMsg === "string" ? res.json.retMsg : res.text.slice(0, 200),
      );
    }
    return res.json?.result as T;
  }
}
