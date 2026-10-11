"use server";

import { type MeResponse, updateProfileSchema } from "@atc/shared";
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
    baseCurrency: formData.get("baseCurrency") || undefined,
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
