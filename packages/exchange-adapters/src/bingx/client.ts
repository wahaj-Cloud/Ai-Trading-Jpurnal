import { hmacSha256Hex, joinParams, type Params, resolveFetch, send, sortParams } from "../http.js";
import { type ApiCredentials, type ClientOptions, ExchangeHttpError } from "../types.js";

export interface BingxClientOptions extends ClientOptions {
  baseUrl?: string;
}

/**
 * Signed REST client for BingX OpenAPI.
 * Signature: HMAC-SHA256 hex of the ASCII-sorted, unencoded query string (timestamp included),
 * appended as &signature=. Errors usually arrive as HTTP 200 with a non-zero `code`.
 */
export class BingxClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(
    private readonly credentials: ApiCredentials,
    options: BingxClientOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? "https://open-api.bingx.com";
    this.fetchFn = resolveFetch(options);
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async get<T>(path: string, params: Params = {}): Promise<T> {
    const query = joinParams(sortParams({ ...params, timestamp: this.now() }));
    const signature = hmacSha256Hex(this.credentials.apiSecret, query);
    const res = await send(this.fetchFn, `${this.baseUrl}${path}?${query}&signature=${signature}`, {
      headers: { "X-BX-APIKEY": this.credentials.apiKey },
      timeoutMs: this.timeoutMs,
    });
    const raw = res.json?.code;
    const code = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : null;
    if (!res.ok || (code !== null && code !== 0)) {
      throw new ExchangeHttpError(
        res.status,
        code,
        typeof res.json?.msg === "string" ? res.json.msg : res.text.slice(0, 200),
      );
    }
    return res.json?.data as T;
  }
}
