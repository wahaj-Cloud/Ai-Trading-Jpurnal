"use client";

import { GOAL_METRIC_CODES, GOAL_METRICS, type RiskLimits } from "@atc/shared";
import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { addGoalAction, deleteGoalAction, type FormState, saveRiskLimitsAction } from "./actions";

const initial: FormState = { status: "idle" };

function Status({ state }: { state: FormState }) {
  if (state.status === "idle") return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={state.status === "error" ? "text-sm text-loss" : "text-sm text-ink-muted"}
    >
      {state.message}
    </p>
  );
}

export function RiskLimitsForm({ limits }: { limits: RiskLimits }) {
  const [state, action, pending] = useActionState(saveRiskLimitsAction, initial);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Maximum daily loss (USD)"
          htmlFor="maxDailyLoss"
          hint="Warned at 80%, alerted when reached"
          error={e.maxDailyLoss}
        >
          <Input
            id="maxDailyLoss"
            name="maxDailyLoss"
            inputMode="decimal"
            defaultValue={limits.maxDailyLoss ?? ""}
            placeholder="No limit"
          />
        </Field>
        <Field label="Maximum trades per day" htmlFor="maxTradesPerDay" error={e.maxTradesPerDay}>
          <Input
            id="maxTradesPerDay"
            name="maxTradesPerDay"
            inputMode="numeric"
            defaultValue={limits.maxTradesPerDay ?? ""}
            placeholder="No limit"
          />
        </Field>
        <Field
          label="Maximum drawdown (USD)"
          htmlFor="maxDrawdown"
          hint="Fall from your equity peak"
          error={e.maxDrawdown}
        >
          <Input
            id="maxDrawdown"
            name="maxDrawdown"
            inputMode="decimal"
            defaultValue={limits.maxDrawdown ?? ""}
            placeholder="No limit"
          />
        </Field>
        <Field
          label="Daily profit target (USD)"
          htmlFor="dailyProfitTarget"
          hint="A reminder to protect a good day"
          error={e.dailyProfitTarget}
        >
          <Input
            id="dailyProfitTarget"
            name="dailyProfitTarget"
            inputMode="decimal"
            defaultValue={limits.dailyProfitTarget ?? ""}
            placeholder="None"
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save limits"}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function AddGoalForm() {
  const [state, action, pending] = useActionState(addGoalAction, initial);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-[1fr_1.4fr_1fr_auto] sm:items-end">
      <Field label="Every" htmlFor="period" error={e.period}>
        <Select id="period" name="period" defaultValue="WEEK">
          <option value="WEEK">Week</option>
          <option value="MONTH">Month</option>
        </Select>
      </Field>
      <Field label="Goal" htmlFor="metric" error={e.metric}>
        <Select id="metric" name="metric" defaultValue="NET_PNL">
          {GOAL_METRIC_CODES.map((m) => (
            <option key={m} value={m}>
              {GOAL_METRICS[m].label}
              {GOAL_METRICS[m].unit ? ` (${GOAL_METRICS[m].unit})` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Target" htmlFor="target" error={e.target}>
        <Input id="target" name="target" inputMode="decimal" required />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Add goal"}
      </Button>
      <div className="sm:col-span-4">
        <Status state={state} />
      </div>
    </form>
  );
}

export function DeleteGoalButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => start(async () => void (await deleteGoalAction(id)))}
    >
      {pending ? "Removing…" : "Remove"}
    </Button>
  );
}
