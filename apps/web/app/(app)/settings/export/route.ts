import { ApiError, apiFetch } from "@/lib/api";

/** Downloads the trader's data as a JSON file (through the API, with their session). */
export async function GET(): Promise<Response> {
  try {
    const data = await apiFetch<unknown>("/v1/me/export", { signal: AbortSignal.timeout(60_000) });
    const day = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="wickmentor-data-${day}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 502;
    const message =
      status === 429
        ? "You've downloaded your data a few times already this hour. Try again later."
        : "Your data could not be prepared right now. Try again in a moment.";
    return new Response(message, { status, headers: { "content-type": "text/plain" } });
  }
}
