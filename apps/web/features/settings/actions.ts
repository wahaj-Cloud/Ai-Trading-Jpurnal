"use server";

import { type DashboardLayout, type MeResponse, updateProfileSchema } from "@atc/shared";
import { revalidatePath } from "next/cache";
import { ApiError, apiFetch } from "@/lib/api";

export interface ProfileFormState {
  status: "idle" | "saved" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

export async function updateProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const raw = {
    name: String(formData.get("name") ?? "").trim() || undefined,
    timezone: formData.get("timezone") || undefined,
    displayCurrency: formData.get("displayCurrency") || undefined,
    pnlColorScheme: formData.get("pnlColorScheme") || undefined,
  };

  // Same schema the API enforces: instant feedback here, authoritative check there.
  const parsed = updateProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", message: "Check the highlighted fields.", fieldErrors };
  }

  try {
    await apiFetch<MeResponse>("/v1/me", { method: "PATCH", body: JSON.stringify(parsed.data) });
  } catch (err) {
    const message =
      err instanceof ApiError && err.status < 500 && err.body?.message
        ? err.body.message
        : "Your changes were not saved. Try again in a moment.";
    return { status: "error", message };
  }

  revalidatePath("/", "layout");
  return { status: "saved", message: "Changes saved." };
}

/** Quick switch from the top bar's globe menu. */
export async function setDisplayCurrencyAction(code: string): Promise<{ ok: boolean }> {
  const parsed = updateProfileSchema.safeParse({ displayCurrency: code });
  if (!parsed.success) return { ok: false };
  try {
    await apiFetch<MeResponse>("/v1/me", { method: "PATCH", body: JSON.stringify(parsed.data) });
  } catch {
    return { ok: false };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Saves the dashboard's widget order and visibility. */
export async function saveDashboardLayoutAction(layout: DashboardLayout): Promise<{ ok: boolean }> {
  const parsed = updateProfileSchema.safeParse({ dashboardLayout: layout });
  if (!parsed.success) return { ok: false };
  try {
    await apiFetch<MeResponse>("/v1/me", { method: "PATCH", body: JSON.stringify(parsed.data) });
  } catch {
    return { ok: false };
  }
  revalidatePath("/dashboard");
  return { ok: true };
}
