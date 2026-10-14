"use server";

import {
  type SetupDto,
  type SetupPreviewDto,
  setupInputSchema,
  setupPreviewSchema,
} from "@atc/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (err: unknown, fallback: string): { ok: false; message: string } => ({
  ok: false,
  message:
    err instanceof ApiError && err.body?.message && err.status < 500 ? err.body.message : fallback,
});
const firstIssue = (issues: { path: PropertyKey[]; message: string }[]) => {
  const i = issues[0];
  return i ? `${i.path.length ? `${i.path.join(" › ")}: ` : ""}${i.message}` : "Check the setup.";
};

export async function previewSetupAction(input: unknown): Promise<ActionResult<SetupPreviewDto>> {
  const parsed = setupPreviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error.issues) };
  try {
    return {
      ok: true,
      data: await apiFetch<SetupPreviewDto>("/v1/setups/preview", {
        method: "POST",
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(20_000),
      }),
    };
  } catch (err) {
    return fail(err, "Could not run the preview. Try again.");
  }
}

/** Creates (no id) or updates a setup, then returns to the list. */
export async function saveSetupAction(
  id: string | null,
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = setupInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error.issues) };
  if (id !== null && !UUID.test(id)) return { ok: false, message: "Unknown setup" };
  try {
    await apiFetch<SetupDto>(id ? `/v1/setups/${id}` : "/v1/setups", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(parsed.data),
    });
  } catch (err) {
    return fail(err, "Could not save the setup. Try again.");
  }
  revalidatePath("/setups");
  redirect("/setups");
}

export async function toggleSetupAction(id: string, active: boolean): Promise<ActionResult<null>> {
  if (!UUID.test(id)) return { ok: false, message: "Unknown setup" };
  try {
    await apiFetch(`/v1/setups/${id}/${active ? "resume" : "pause"}`, { method: "POST" });
    revalidatePath("/setups");
    return { ok: true, data: null };
  } catch (err) {
    return fail(err, "Could not change the setup.");
  }
}

export async function deleteSetupAction(id: string): Promise<ActionResult<null>> {
  if (!UUID.test(id)) return { ok: false, message: "Unknown setup" };
  try {
    await apiFetch(`/v1/setups/${id}`, { method: "DELETE" });
    revalidatePath("/setups");
    return { ok: true, data: null };
  } catch (err) {
    return fail(err, "Could not delete the setup.");
  }
}

export async function dismissAlertAction(id: string): Promise<ActionResult<null>> {
  if (!UUID.test(id)) return { ok: false, message: "Unknown alert" };
  try {
    await apiFetch(`/v1/setup-alerts/${id}`, { method: "PATCH" });
    revalidatePath("/setups");
    return { ok: true, data: null };
  } catch (err) {
    return fail(err, "Could not dismiss the alert.");
  }
}
