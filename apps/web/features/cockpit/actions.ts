"use server";

import { createScalpAlertSchema, type ScalpAlertDto, updateScalpAlertSchema } from "@atc/shared";
import { revalidatePath } from "next/cache";
import { ApiError, apiFetch } from "@/lib/api";

export type AlertActionState = { status: "idle" | "ok" | "error"; message?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const message = (err: unknown, fallback: string) =>
  err instanceof ApiError && err.body?.message && err.status < 500 ? err.body.message : fallback;

export async function createScalpAlertAction(
  _prev: AlertActionState,
  form: FormData,
): Promise<AlertActionState> {
  const parsed = createScalpAlertSchema.safeParse({
    symbol: form.get("symbol"),
    tf: form.get("tf"),
    direction: form.get("direction"),
    minCount: form.get("minCount"),
    noNews: form.get("noNews") === "on",
    cooldownMin: form.get("cooldownMin"),
    planStopRanges: form.get("planStopRanges") ?? undefined,
    planTargetR: form.get("planTargetR") ?? undefined,
    planRiskUsd: form.get("planRiskUsd") ? form.get("planRiskUsd") : null,
  });
  if (!parsed.success) return { status: "error", message: "Check the alert settings." };
  try {
    await apiFetch<ScalpAlertDto>("/v1/scalp-alerts", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
  } catch (err) {
    return { status: "error", message: message(err, "Could not save the alert. Try again.") };
  }
  revalidatePath("/cockpit");
  return { status: "ok", message: "Alert saved. It is checked every few seconds." };
}

export async function toggleScalpAlertAction(id: string, enabled: boolean): Promise<void> {
  if (!UUID.test(id)) return;
  const body = updateScalpAlertSchema.parse({ enabled });
  await apiFetch(`/v1/scalp-alerts/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  revalidatePath("/cockpit");
}

export async function deleteScalpAlertAction(id: string): Promise<void> {
  if (!UUID.test(id)) return;
  await apiFetch(`/v1/scalp-alerts/${id}`, { method: "DELETE" });
  revalidatePath("/cockpit");
}
