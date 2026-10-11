"use server";

import { adminPlanChangeSchema, adminSuspendSchema, announcementInputSchema } from "@atc/shared";
import { revalidatePath } from "next/cache";
import { ApiError, apiFetch } from "@/lib/api";

export interface AdminFormState {
  status: "idle" | "saved" | "error";
  message?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (err: unknown, fallback: string): AdminFormState => ({
  status: "error",
  message: err instanceof ApiError && err.body?.message ? err.body.message : fallback,
});

export async function changePlanAction(
  userId: string,
  _p: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  if (!UUID.test(userId)) return { status: "error", message: "Unknown user" };
  const parsed = adminPlanChangeSchema.safeParse({
    planCode: form.get("planCode"),
    reason: form.get("reason"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };
  try {
    await apiFetch(`/v1/admin/users/${userId}/plan`, {
      method: "PUT",
      body: JSON.stringify(parsed.data),
    });
  } catch (err) {
    return fail(err, "Could not change the plan.");
  }
  revalidatePath(`/admin/users/${userId}`);
  return { status: "saved", message: "Plan changed." };
}

export async function suspendAction(
  userId: string,
  _p: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  if (!UUID.test(userId)) return { status: "error", message: "Unknown user" };
  const parsed = adminSuspendSchema.safeParse({
    suspended: form.get("suspended") === "true",
    reason: form.get("reason"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };
  try {
    await apiFetch(`/v1/admin/users/${userId}/suspension`, {
      method: "PUT",
      body: JSON.stringify(parsed.data),
    });
  } catch (err) {
    return fail(err, "Could not update the account.");
  }
  revalidatePath(`/admin/users/${userId}`);
  return {
    status: "saved",
    message: parsed.data.suspended ? "Account suspended." : "Account restored.",
  };
}

export async function createAnnouncementAction(
  _p: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  const endsAt = String(form.get("endsAt") ?? "");
  const parsed = announcementInputSchema.safeParse({
    title: form.get("title"),
    body: form.get("body"),
    level: form.get("level"),
    endsAt: endsAt ? new Date(endsAt).toISOString() : null,
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };
  try {
    await apiFetch("/v1/admin/announcements", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
  } catch (err) {
    return fail(err, "Could not publish the announcement.");
  }
  revalidatePath("/admin/announcements");
  revalidatePath("/", "layout");
  return { status: "saved", message: "Published." };
}

export async function endAnnouncementAction(id: string): Promise<void> {
  if (!UUID.test(id)) return;
  await apiFetch(`/v1/admin/announcements/${id}`, { method: "DELETE" }).catch(() => undefined);
  revalidatePath("/admin/announcements");
  revalidatePath("/", "layout");
}
