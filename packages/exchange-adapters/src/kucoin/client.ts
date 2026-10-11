import { hmacSha256Base64, joinParams, type Params, resolveFetch, send } from "../http.js";
import { type ApiCredentials, type ClientOptions, ExchangeHttpError } from "../types.js";

export interface KucoinClientOptions extends ClientOptions {
  spotBaseUrl?: string;
  futuresBaseUrl?: string;
}

type Market = "spot" | "futures";

/** Most endpoints answer "200000"; some futures history endpoints answer "200". */
const SUCCESS = new Set(["200000", "200"]);

/**
 * Signed REST client for KuCoin spot and futures.
 * Signature: base64(HMAC-SHA256(secret, timestamp + METHOD + path?query + body)).
 * The passphrase is sent encrypted the same way (key version 2+).
 */
export class KucoinClient {
  private readonly baseUrls: Record<Market, string>;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(
    private readonly credentials: ApiCredentials & { passphrase: string },
    options: KucoinClientOptions = {},
  ) {
    this.baseUrls = {
      spot: options.spotBaseUrl ?? "https://api.kucoin.com",
      futures: options.futuresBaseUrl ?? "https://api-futures.kucoin.com",
    };
    this.fetchFn = resolveFetch(options);
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** Unauthenticated market data (e.g. contract multipliers). */
  async publicGet<T>(market: Market, path: string, params: Params = {}): Promise<T> {
    const query = joinParams(params);
    const res = await send(
      this.fetchFn,
      `${this.baseUrls[market]}${path}${query ? `?${query}` : ""}`,
      {
        headers: {},
        timeoutMs: this.timeoutMs,
      },
    );
    return unwrap<T>(res);
  }

  async get<T>(market: Market, path: string, params: Params = {}): Promise<T> {
    const query = joinParams(params);
    const endpoint = query ? `${path}?${query}` : path;
    const timestamp = String(this.now());
    const { apiKey, apiSecret, passphrase } = this.credentials;

    const res = await send(this.fetchFn, `${this.baseUrls[market]}${endpoint}`, {
      headers: {
        "KC-API-KEY": apiKey,
        "KC-API-SIGN": hmacSha256Base64(apiSecret, `${timestamp}GET${endpoint}`),
        "KC-API-TIMESTAMP": timestamp,
        "KC-API-PASSPHRASE": hmacSha256Base64(apiSecret, passphrase),
        "KC-API-KEY-VERSION": "2",
      },
      timeoutMs: this.timeoutMs,
    });
    return unwrap<T>(res);
  }
}

function unwrap<T>(res: Awaited<ReturnType<typeof send>>): T {
  const code = typeof res.json?.code === "string" ? res.json.code : null;
  if (!res.ok || code === null || !SUCCESS.has(code)) {
    throw new ExchangeHttpError(
      res.status,
      code,
      typeof res.json?.msg === "string" ? res.json.msg : res.text.slice(0, 200),
    );
  }
  return res.json?.data as T;
}
