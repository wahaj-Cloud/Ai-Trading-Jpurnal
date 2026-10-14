import { apiRaw } from "@/lib/api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** CSV of a backtest's simulated trades (through the web server, like every export). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response("Unknown test", { status: 400 });
  const res = await apiRaw(`/v1/backtests/${id}/export`);
  if (!res.ok)
    return new Response("The export could not be created. Try again in a minute.", {
      status: res.status === 404 ? 404 : 502,
    });
  const headers = new Headers({ "cache-control": "private, no-store" });
  for (const h of ["content-type", "content-disposition"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.body, { status: 200, headers });
}
