"use server";

import {
  type BacktestRunDto,
  type BacktestTradeChartDto,
  backtestInputSchema,
  type WhatIfFiltersInput,
  type WhatIfResultDto,
  type WhatIfScenarioDto,
  whatIfFiltersSchema,
  whatIfScenarioInputSchema,
} from "@atc/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { convertWhatIf } from "@/features/currency/convert";
import { ApiError, apiFetch } from "@/lib/api";
import { getDisplay } from "@/lib/display";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (err: unknown, fallback: string): { ok: false; message: string } => ({
  ok: false,
  message:
    err instanceof ApiError && err.body?.message && err.status < 500 ? err.body.message : fallback,
});

export async function runWhatIfAction(
  input: WhatIfFiltersInput,
): Promise<ActionResult<{ result: WhatIfResultDto; currency: string }>> {
  const parsed = whatIfFiltersSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the rules: some values are not valid." };
  try {
    const [res, display] = await Promise.all([
      apiFetch<WhatIfResultDto>("/v1/what-if/run", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      }),
      getDisplay(),
    ]);
    return { ok: true, data: { result: convertWhatIf(res, display), currency: display.code } };
  } catch (err) {
    return fail(err, "Could not run the scenario. Try again.");
  }
}

export async function saveScenarioAction(
  name: string,
  filters: WhatIfFiltersInput,
): Promise<ActionResult<WhatIfScenarioDto>> {
  const parsed = whatIfScenarioInputSchema.safeParse({ name, filters });
  if (!parsed.success)
    return { ok: false, message: "Give the scenario a name (up to 60 letters)." };
  try {
    const row = await apiFetch<WhatIfScenarioDto>("/v1/what-if/scenarios", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
    revalidatePath("/lab");
    return { ok: true, data: row };
  } catch (err) {
    return fail(err, "Could not save the scenario.");
  }
}

export async function deleteScenarioAction(id: string): Promise<ActionResult<null>> {
  if (!UUID.test(id)) return { ok: false, message: "Unknown scenario" };
  try {
    await apiFetch(`/v1/what-if/scenarios/${id}`, { method: "DELETE" });
    revalidatePath("/lab");
    return { ok: true, data: null };
  } catch (err) {
    return fail(err, "Could not delete the scenario.");
  }
}

export async function startBacktestAction(input: unknown): Promise<ActionResult<null>> {
  const parsed = backtestInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check the test settings.",
    };
  let run: BacktestRunDto;
  try {
    run = await apiFetch<BacktestRunDto>("/v1/backtests", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
  } catch (err) {
    return fail(err, "Could not start the test. Try again.");
  }
  revalidatePath("/lab/strategy");
  redirect(`/lab/strategy/${run.id}`);
}

export async function deleteBacktestAction(id: string): Promise<ActionResult<null>> {
  if (!UUID.test(id)) return { ok: false, message: "Unknown test" };
  try {
    await apiFetch(`/v1/backtests/${id}`, { method: "DELETE" });
  } catch (err) {
    return fail(err, "Could not delete the test.");
  }
  revalidatePath("/lab/strategy");
  redirect("/lab/strategy");
}

export async function backtestTradeChartAction(
  runId: string,
  tradeId: string,
): Promise<ActionResult<BacktestTradeChartDto>> {
  if (!UUID.test(runId) || !UUID.test(tradeId)) return { ok: false, message: "Unknown trade" };
  try {
    return {
      ok: true,
      data: await apiFetch<BacktestTradeChartDto>(`/v1/backtests/${runId}/trades/${tradeId}/chart`),
    };
  } catch (err) {
    return fail(err, "Could not load the chart.");
  }
}
