import { hmacSha256Base64, type Params, resolveFetch, send } from "../http.js";
import { type ApiCredentials, type ClientOptions, ExchangeHttpError } from "../types.js";

export interface OkxClientOptions extends ClientOptions {
  /** Fixes the API host (tests, or one region). Without it, the regional hosts are tried in turn. */
  baseUrl?: string;
}

/** OKX serves each region's accounts from its own host; a key only works on its region's host. */
const REGIONAL_HOSTS = ["https://www.okx.com", "https://eea.okx.com", "https://us.okx.com"];
/** "APIKey does not match current environment" / "API key doesn't exist": try the next region. */
const WRONG_REGION = new Set(["50101", "50119"]);

/**
 * Signed REST client for OKX V5.
 * Signature: Base64 HMAC-SHA256 of timestamp (ISO, ms) + "GET" + path with query.
 * Errors arrive as a non-"0" `code`, often with HTTP 200.
 */
export class OkxClient {
  private hosts: string[];
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(
    private readonly credentials: ApiCredentials,
    options: OkxClientOptions = {},
  ) {
    this.hosts = options.baseUrl ? [options.baseUrl] : [...REGIONAL_HOSTS];
    this.fetchFn = resolveFetch(options);
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** Signed GET. On a region mismatch the next regional host is tried and then kept. */
  async get<T>(path: string, params: Params = {}): Promise<T> {
    for (;;) {
      try {
        return await this.request<T>(this.hosts[0] as string, path, params, true);
      } catch (err) {
        const regionMiss =
          err instanceof ExchangeHttpError && WRONG_REGION.has(String(err.exchangeCode));
        if (!regionMiss || this.hosts.length === 1) throw err;
        this.hosts = this.hosts.slice(1);
      }
    }
  }

  /** Unsigned GET for public market data (instrument specifications). */
  publicGet<T>(path: string, params: Params = {}): Promise<T> {
    return this.request<T>(this.hosts[0] as string, path, params, false);
  }

  private async request<T>(
    host: string,
    path: string,
    params: Params,
    signed: boolean,
  ): Promise<T> {
    const query = new URLSearchParams(
      Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]),
    ).toString();
    const requestPath = `${path}${query ? `?${query}` : ""}`;
    const headers: Record<string, string> = {};
    if (signed) {
      const timestamp = new Date(this.now()).toISOString();
      headers["OK-ACCESS-KEY"] = this.credentials.apiKey;
      headers["OK-ACCESS-SIGN"] = hmacSha256Base64(
        this.credentials.apiSecret,
        `${timestamp}GET${requestPath}`,
      );
      headers["OK-ACCESS-TIMESTAMP"] = timestamp;
      headers["OK-ACCESS-PASSPHRASE"] = this.credentials.passphrase ?? "";
    }
    const res = await send(this.fetchFn, `${host}${requestPath}`, {
      headers,
      timeoutMs: this.timeoutMs,
    });
    const code = res.json?.code;
    if (!res.ok || (code !== undefined && String(code) !== "0")) {
      throw new ExchangeHttpError(
        res.status,
        code === undefined || code === null ? null : String(code),
        typeof res.json?.msg === "string" && res.json.msg ? res.json.msg : res.text.slice(0, 200),
      );
    }
    return res.json?.data as T;
  }
}
