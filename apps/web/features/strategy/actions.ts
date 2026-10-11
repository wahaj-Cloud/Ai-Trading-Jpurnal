"use server";

import { revalidatePath } from "next/cache";
import { ApiError, apiFetch } from "@/lib/api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requestContextAction(positionId: string): Promise<{ error?: string }> {
  if (!UUID.test(positionId)) return { error: "Unknown trade." };
  try {
    await apiFetch(`/v1/positions/${positionId}/context`, { method: "POST" });
  } catch (err) {
    return {
      error:
        err instanceof ApiError && err.body?.message && err.status < 500
          ? err.body.message
          : "Could not start the analysis. Try again shortly.",
    };
  }
  revalidatePath(`/trades/${positionId}`);
  return {};
}
