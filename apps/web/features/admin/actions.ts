"use server";

import {
  adminPlanChangeSchema,
  adminPlanUpdateSchema,
  adminSuspendSchema,
  announcementInputSchema,
} from "@atc/shared";
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

const PLAN_CODES = new Set(["FREE", "PRO", "PREMIUM", "ENTERPRISE"]);
const num = (v: FormDataEntryValue | null) => (v === null || v === "" ? Number.NaN : Number(v));

/** Saves a plan's list price and limits (affects every user on the plan at once). */
export async function updatePlanAction(
  code: string,
  _p: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  if (!PLAN_CODES.has(code)) return { status: "error", message: "Unknown plan" };
  const price = form.get("priceUsd");
  const parsed = adminPlanUpdateSchema.safeParse({
    priceUsd: price === null || price === "" ? null : Number(price),
    exchangeAccounts: num(form.get("exchangeAccounts")),
    aiReviewsPerMonth: num(form.get("aiReviewsPerMonth")),
    historyDays: num(form.get("historyDays")),
    coachMessagesPerDay: num(form.get("coachMessagesPerDay")),
    aiBudgetUsd: num(form.get("aiBudgetUsd")),
    brokerAccounts: num(form.get("brokerAccounts")),
    setups: num(form.get("setups")),
    setupAlertEmail: num(form.get("setupAlertEmail")),
    whatIf: num(form.get("whatIf")),
    backtestRunsPerMonth: num(form.get("backtestRunsPerMonth")),
    backtestHistoryMonths: num(form.get("backtestHistoryMonths")),
    marketPulseCoins: num(form.get("marketPulseCoins")),
    marketPulseAllWindows: num(form.get("marketPulseAllWindows")),
    liquidationMap: num(form.get("liquidationMap")),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { status: "error", message: `${issue?.path.join(".")}: ${issue?.message}` };
  }
  try {
    await apiFetch(`/v1/admin/plans/${code}`, { method: "PUT", body: JSON.stringify(parsed.data) });
  } catch (err) {
    return fail(err, "Could not save the plan.");
  }
  revalidatePath("/admin/costs");
  return { status: "saved", message: "Saved. Applies to everyone on this plan now." };
}

export async function foundingMemberAction(
  userId: string,
  _p: AdminFormState,
  form: FormData,
): Promise<AdminFormState> {
  if (!UUID.test(userId)) return { status: "error", message: "Unknown user" };
  const foundingMember = form.get("foundingMember") === "true";
  try {
    await apiFetch(`/v1/admin/users/${userId}/founding`, {
      method: "PUT",
      body: JSON.stringify({ foundingMember }),
    });
  } catch (err) {
    return fail(err, "Could not update the founding-member badge.");
  }
  revalidatePath(`/admin/users/${userId}`);
  return {
    status: "saved",
    message: foundingMember ? "Marked as a founding member." : "Founding-member badge removed.",
  };
}
