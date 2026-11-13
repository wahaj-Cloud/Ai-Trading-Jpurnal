"use client";

import { type AppPrefs, START_PAGES, type StartPage } from "@atc/shared";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { type ProfileFormState, saveAppPrefsAction } from "./actions";

const initial: ProfileFormState = { status: "idle" };
const WINDOWS = [
  ["5m", "5 minutes"],
  ["15m", "15 minutes"],
  ["30m", "30 minutes"],
  ["1h", "1 hour"],
  ["4h", "4 hours"],
  ["24h", "1 day"],
] as const;

/** How the app behaves: where it opens, defaults for tools, and motion. */
export function AppPrefsForm({ prefs }: { prefs: AppPrefs }) {
  const [state, action, pending] = useActionState(saveAppPrefsAction, initial);
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-8" noValidate>
      <fieldset className="grid gap-5">
        <legend className="mb-1 font-semibold">App</legend>
        <Field label="Open the app on" htmlFor="startPage" hint="Where you land after signing in">
          <Select id="startPage" name="startPage" defaultValue={prefs.startPage}>
            {(Object.keys(START_PAGES) as StartPage[]).map((k) => (
              <option key={k} value={k}>
                {START_PAGES[k].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Order Flow opens on" htmlFor="orderflowWindow">
          <Select id="orderflowWindow" name="orderflowWindow" defaultValue={prefs.orderflowWindow}>
            {WINDOWS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="reduceMotion"
            defaultChecked={prefs.reduceMotion}
            className="mt-0.5 h-4 w-4 accent-[var(--color-coach)]"
          />
          <span>
            Reduce motion
            <span className="block text-xs text-ink-faint">
              Turns off animations and moving effects across the app.
            </span>
          </span>
        </label>
      </fieldset>

      <fieldset className="grid gap-5">
        <legend className="mb-1 font-semibold">Trading defaults</legend>
        <p className="text-sm text-ink-muted">
          Filled in for you in the calculators, the trade grader and new paper bots. You can still
          change them each time.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Account size (US$)"
            htmlFor="accountSizeUsd"
            error={err.accountSizeUsd}
            hint="Leave empty to use examples"
          >
            <Input
              id="accountSizeUsd"
              name="accountSizeUsd"
              inputMode="decimal"
              placeholder="e.g. 5000"
              defaultValue={prefs.accountSizeUsd ?? ""}
            />
          </Field>
          <Field
            label="Risk per trade (%)"
            htmlFor="riskPct"
            error={err.riskPct}
            hint="Many traders use 0.5–1%"
          >
            <Input
              id="riskPct"
              name="riskPct"
              inputMode="decimal"
              placeholder="e.g. 1"
              defaultValue={prefs.riskPct ?? ""}
            />
          </Field>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-4 border-t border-rule pt-6">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save preferences"}
        </Button>
        {state.message && (
          <p
            role="status"
            className={cn("text-sm", state.status === "error" ? "text-loss" : "text-ink-muted")}
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
