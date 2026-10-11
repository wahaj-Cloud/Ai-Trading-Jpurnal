/** Test helper: a fake exchange that routes by path and records every request it receives. */
export interface RecordedRequest {
  url: URL;
  headers: Record<string, string>;
}

export type Route = (
  url: URL,
  headers: Record<string, string>,
) => { status?: number; body: unknown } | undefined;

export function fakeExchange(route: Route) {
  const requests: RecordedRequest[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    requests.push({ url, headers });
    const hit = route(url, headers);
    if (!hit) return Response.json({ msg: "not found" }, { status: 404 });
    return Response.json(hit.body, { status: hit.status ?? 200 });
  }) as typeof fetch;
  return { fetch: fetchFn, requests };
}

export const networkDown = (async () => {
  throw new TypeError("fetch failed");
}) as typeof fetch;
