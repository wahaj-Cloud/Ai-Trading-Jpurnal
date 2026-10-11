import { createHmac } from "node:crypto";
import { type ClientOptions, ExchangeNetworkError } from "./types.js";

export interface RawResponse {
  status: number;
  ok: boolean;
  text: string;
  json: Record<string, unknown> | null;
}

/** The fetch a client should use: the injected one (tests), throttled by `beforeRequest` if given. */
export function resolveFetch(options: ClientOptions): typeof fetch {
  const base = options.fetch ?? fetch;
  const before = options.beforeRequest;
  if (!before) return base;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    await before(new URL(String(input)));
    return base(input, init);
  }) as typeof fetch;
}

/** Sends one request with a timeout. Network failures become ExchangeNetworkError. */
export async function send(
  fetchFn: typeof fetch,
  url: string,
  init: { headers: Record<string, string>; timeoutMs: number },
): Promise<RawResponse> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      headers: init.headers,
      // Never follow a redirect: it would carry our API-key headers to another host.
      redirect: "error",
      signal: AbortSignal.timeout(init.timeoutMs),
    });
  } catch (err) {
    throw new ExchangeNetworkError(err);
  }
  const text = await readCapped(res);
  return { status: res.status, ok: res.ok, text, json: parseObject(text) };
}

/** Largest exchange response we accept (the biggest real pages are a few MB). */
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/** Reads a response body, refusing bodies over the cap instead of exhausting memory. */
export async function readCapped(res: Response, max = MAX_RESPONSE_BYTES): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    throw new ExchangeNetworkError(new Error(`Response too large (${declared} bytes)`));
  }
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => undefined);
        throw new ExchangeNetworkError(new Error("Response too large"));
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof ExchangeNetworkError) throw err;
    throw new ExchangeNetworkError(err);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export const hmacSha256Hex = (secret: string, message: string): string =>
  createHmac("sha256", secret).update(message).digest("hex");

export const hmacSha256Base64 = (secret: string, message: string): string =>
  createHmac("sha256", secret).update(message).digest("base64");

export type Params = Record<string, string | number | boolean>;

/** `a=1&b=2` in insertion order, values unencoded (all our params are URL-safe). */
export function joinParams(params: Params): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join("&");
}

export function sortParams(params: Params): Params {
  return Object.fromEntries(
    Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

export function stringField(obj: unknown, key: string): string | null {
  if (typeof obj !== "object" || obj === null) return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" || typeof v === "number" ? String(v) : null;
}
