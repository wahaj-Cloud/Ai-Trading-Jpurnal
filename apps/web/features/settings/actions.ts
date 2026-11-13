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

/** App preferences: start page, Order Flow timeframe, reduced motion, trading defaults. */
export async function saveAppPrefsAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const num = (k: string) => {
    const v = String(formData.get(k) ?? "").replace(/[,\s$%]/g, "");
    return v === "" ? null : Number(v);
  };
  const parsed = updateProfileSchema.safeParse({
    appPrefs: {
      startPage: formData.get("startPage") || undefined,
      orderflowWindow: formData.get("orderflowWindow") || undefined,
      reduceMotion: formData.get("reduceMotion") === "on",
      accountSizeUsd: num("accountSizeUsd"),
      riskPct: num("riskPct"),
    },
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[1] ?? issue.path[0] ?? "form");
      fieldErrors[key] ??=
        key === "accountSizeUsd"
          ? "Enter an amount above 0"
          : key === "riskPct"
            ? "Between 0.01% and 10%"
            : issue.message;
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
  return { status: "saved", message: "Preferences saved." };
}
