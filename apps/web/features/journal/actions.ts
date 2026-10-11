"use server";

import { journalInputSchema } from "@atc/shared";
import { revalidatePath } from "next/cache";
import { ApiError, apiFetch } from "@/lib/api";
import { journalFromForm } from "./form";

export interface JournalFormState {
  status: "idle" | "saved" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveJournalAction(
  positionId: string,
  _prev: JournalFormState,
  form: FormData,
): Promise<JournalFormState> {
  // Bound arguments come from the browser: re-validate before building a URL from them.
  if (!UUID.test(positionId)) return { status: "error", message: "Unknown trade." };
  const parsed = journalInputSchema.safeParse(journalFromForm(form));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0] ?? "form")] ??= i.message;
    return { status: "error", message: "Check the highlighted fields.", fieldErrors };
  }
  try {
    await apiFetch(`/v1/positions/${positionId}/journal`, {
      method: "PUT",
      body: JSON.stringify(parsed.data),
    });
  } catch (err) {
    return {
      status: "error",
      message:
        err instanceof ApiError && err.status === 404
          ? "This trade no longer exists. It may have been merged during a sync."
          : "Could not save your notes. Try again in a moment.",
    };
  }
  revalidatePath(`/trades/${positionId}`);
  revalidatePath("/trades");
  return { status: "saved", message: "Saved." };
}

export async function deleteJournalAction(positionId: string): Promise<{ error?: string }> {
  if (!UUID.test(positionId)) return { error: "Unknown trade." };
  try {
    await apiFetch(`/v1/positions/${positionId}/journal`, { method: "DELETE" });
  } catch {
    return { error: "Could not clear the journal. Try again in a moment." };
  }
  revalidatePath(`/trades/${positionId}`);
  revalidatePath("/trades");
  return {};
}
