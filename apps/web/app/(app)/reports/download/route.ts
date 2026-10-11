import { exportQuerySchema, reportQuerySchema } from "@atc/shared";
import { apiRaw } from "@/lib/api";

/**
 * Downloads a report or export through the web server (the browser never talks to the API
 * directly). Parameters are re-validated here before being forwarded.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  let path: string;
  if (kind === "pdf") {
    const q = reportQuerySchema.safeParse({
      period: url.searchParams.get("period") ?? undefined,
      date: url.searchParams.get("date") ?? undefined,
    });
    if (!q.success) return new Response("Invalid report", { status: 400 });
    path = `/v1/reports/pdf?${new URLSearchParams(Object.entries(q.data).filter((e): e is [string, string] => Boolean(e[1])))}`;
  } else if (kind === "csv" || kind === "xlsx") {
    const q = exportQuerySchema.safeParse({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    if (!q.success) return new Response("Invalid range", { status: 400 });
    const qs = new URLSearchParams(
      Object.entries(q.data).filter((e): e is [string, string] => Boolean(e[1])),
    );
    path = `/v1/exports/trades.${kind}${qs.size ? `?${qs}` : ""}`;
  } else {
    return new Response("Unknown export", { status: 400 });
  }

  const res = await apiRaw(path);
  if (!res.ok)
    return new Response("The export could not be created. Try again in a minute.", {
      status: res.status === 429 ? 429 : 502,
    });
  const headers = new Headers();
  for (const h of ["content-type", "content-disposition", "x-export-truncated"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("cache-control", "private, no-store");
  return new Response(res.body, { status: 200, headers });
}
