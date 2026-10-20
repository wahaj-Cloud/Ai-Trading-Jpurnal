"use server";

import { createPaperBotSchema, type PaperBotDto, updatePaperBotSchema } from "@atc/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api";

export type PaperActionState = { status: "idle" | "ok" | "error"; message?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const message = (err: unknown, fallback: string) =>
  err instanceof ApiError && err.body?.message && err.status < 500 ? err.body.message : fallback;
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : undefined);

export async function createPaperBotAction(
  _prev: PaperActionState,
  form: FormData,
): Promise<PaperActionState> {
  const source = str(form.get("source"));
  const common = {
    name: str(form.get("name")),
    symbol: str(form.get("symbol")),
    stopRanges: str(form.get("stopRanges")),
    targetR: str(form.get("targetR")),
    maxHoldMin: str(form.get("maxHoldMin")),
    riskPct: str(form.get("riskPct")),
    feeBps: str(form.get("feeBps")),
    slippageBps: str(form.get("slippageBps")),
    startEquity: str(form.get("startEquity")),
  };
  const parsed = createPaperBotSchema.safeParse(
    source === "SETUP"
      ? { source, ...common, setupId: str(form.get("setupId")) }
      : {
          source: "COCKPIT",
          ...common,
          tf: str(form.get("tf")),
          direction: str(form.get("direction")),
          minCount: str(form.get("minCount")),
          noNews: form.get("noNews") === "on",
        },
  );
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      status: "error",
      message: `Check ${issue?.path.join(".") || "the settings"}: ${issue?.message ?? "invalid"}.`,
    };
  }
  let id: string;
  try {
    const bot = await apiFetch<PaperBotDto>("/v1/paper-bots", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
    id = bot.id;
  } catch (err) {
    return { status: "error", message: message(err, "Could not start the bot. Try again.") };
  }
  revalidatePath("/lab/paper");
  redirect(`/lab/paper/${id}`);
}

async function call(id: string, path: string, init: RequestInit): Promise<string | null> {
  if (!UUID.test(id)) return "Not found";
  try {
    await apiFetch(`/v1/paper-bots/${id}${path}`, init);
    return null;
  } catch (err) {
    return message(err, "Something went wrong. Try again.");
  } finally {
    revalidatePath("/lab/paper");
    revalidatePath(`/lab/paper/${id}`);
  }
}

export async function togglePaperBotAction(id: string, enabled: boolean): Promise<string | null> {
  const body = updatePaperBotSchema.parse({ enabled });
  return call(id, "", { method: "PATCH", body: JSON.stringify(body) });
}

export async function resetPaperBotAction(id: string): Promise<string | null> {
  return call(id, "/reset", { method: "POST" });
}

export async function closePaperTradeAction(id: string): Promise<string | null> {
  return call(id, "/close", { method: "POST" });
}

export async function deletePaperBotAction(id: string): Promise<string | null> {
  const err = await call(id, "", { method: "DELETE" });
  if (err) return err;
  redirect("/lab/paper");
}
