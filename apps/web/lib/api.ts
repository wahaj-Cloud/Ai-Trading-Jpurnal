import "server-only";
import type { ApiErrorBody } from "@atc/shared";
import { auth } from "@clerk/nextjs/server";
import { serverEnv } from "./env";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | null,
  ) {
    super(body?.message ?? `API request failed with status ${status}`);
  }
}

/**
 * Server-side API client. Attaches the signed-in user's short-lived session token.
 * The browser never talks to the API directly in this phase, so API_URL stays private.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) throw new ApiError(401, null);

  const res = await fetch(`${serverEnv().API_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Raw API response (files: PDF, CSV, Excel). Same authentication as apiFetch. */
export async function apiRaw(path: string): Promise<Response> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) throw new ApiError(401, null);
  return fetch(`${serverEnv().API_URL}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
}
