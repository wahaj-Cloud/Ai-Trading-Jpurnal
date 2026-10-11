"use server";

import {
  goalInputSchema,
  NOTIFICATION_KIND_CODES,
  type NotificationKind,
  notificationPrefsSchema,
  riskLimitsSchema,
} from "@atc/shared";
import { revalidatePath } from "next/cache";
import { ApiError, apiFetch } from "@/lib/api";

export interface FormState {
  status: "idle" | "saved" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const issues = (list: { path: PropertyKey[]; message: string }[]): FormState => {
  const fieldErrors: Record<string, string> = {};
  for (const i of list) fieldErrors[String(i.path[0] ?? "form")] ??= i.message;
  return { status: "error", message: "Check the highlighted fields.", fieldErrors };
};
const apiError = (err: unknown, fallback: string): FormState => ({
  status: "error",
  message:
    err instanceof ApiError && err.body?.message && err.status < 500 ? err.body.message : fallback,
});

export async function saveRiskLimitsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const trades = text(form, "maxTradesPerDay");
  const parsed = riskLimitsSchema.safeParse({
    maxDailyLoss: text(form, "maxDailyLoss"),
    maxTradesPerDay: trades === null ? null : Number(trades),
    maxDrawdown: text(form, "maxDrawdown"),
    dailyProfitTarget: text(form, "dailyProfitTarget"),
  });
  if (!parsed.success) return issues(parsed.error.issues);
  try {
    await apiFetch("/v1/risk-limits", { method: "PUT", body: JSON.stringify(parsed.data) });
  } catch (err) {
    return apiError(err, "Could not save your limits. Try again.");
  }
  revalidatePath("/goals");
  revalidatePath("/dashboard");
  return { status: "saved", message: "Limits saved." };
}

export async function addGoalAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = goalInputSchema.safeParse({
    period: text(form, "period"),
    metric: text(form, "metric"),
    target: text(form, "target"),
  });
  if (!parsed.success) return issues(parsed.error.issues);
  try {
    await apiFetch("/v1/goals", { method: "POST", body: JSON.stringify(parsed.data) });
  } catch (err) {
    return apiError(err, "Could not save the goal. Try again.");
  }
  revalidatePath("/goals");
  revalidatePath("/dashboard");
  return { status: "saved", message: "Goal saved." };
}

export async function deleteGoalAction(id: string): Promise<{ error?: string }> {
  if (!UUID.test(id)) return { error: "Unknown goal." };
  try {
    await apiFetch(`/v1/goals/${id}`, { method: "DELETE" });
  } catch {
    return { error: "Could not delete the goal." };
  }
  revalidatePath("/goals");
  revalidatePath("/dashboard");
  return {};
}

export async function savePrefsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = Object.fromEntries(
    NOTIFICATION_KIND_CODES.map((k: NotificationKind) => [k, form.get(`email-${k}`) === "on"]),
  );
  const parsed = notificationPrefsSchema.safeParse({
    email,
    reminderHour: Number(form.get("reminderHour")),
  });
  if (!parsed.success) return issues(parsed.error.issues);
  try {
    await apiFetch("/v1/notification-preferences", {
      method: "PUT",
      body: JSON.stringify(parsed.data),
    });
  } catch (err) {
    return apiError(err, "Could not save your preferences.");
  }
  revalidatePath("/settings");
  return { status: "saved", message: "Preferences saved." };
}

export async function markReadAction(ids: string[] | "all"): Promise<void> {
  const clean = ids === "all" ? "all" : ids.filter((i) => UUID.test(i)).slice(0, 100);
  if (clean !== "all" && clean.length === 0) return;
  await apiFetch("/v1/notifications/read", {
    method: "POST",
    body: JSON.stringify({ ids: clean }),
  }).catch(() => undefined);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}
