"use client";

import {
  DEFAULT_EMAIL_PREFS,
  NOTIFICATION_KIND_CODES,
  NOTIFICATION_KINDS,
  type NotificationPrefs,
} from "@atc/shared";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { type FormState, savePrefsAction } from "@/features/goals/actions";

const initial: FormState = { status: "idle" };
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function NotificationPrefsForm({ prefs }: { prefs: NotificationPrefs }) {
  const [state, action, pending] = useActionState(savePrefsAction, initial);
  return (
    <form action={action} className="grid gap-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Email me about</legend>
        <p className="mb-3 text-sm text-ink-muted">
          Everything always appears in the app; choose what also arrives by email.
        </p>
        <div className="grid gap-2">
          {NOTIFICATION_KIND_CODES.map((k) => (
            <label key={k} className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                name={`email-${k}`}
                defaultChecked={prefs.email[k] ?? DEFAULT_EMAIL_PREFS[k]}
                className="h-4 w-4 accent-[var(--color-coach)]"
              />
              {NOTIFICATION_KINDS[k]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        label="Daily journal reminder"
        htmlFor="reminderHour"
        hint="Sent when today's trades still need a review"
      >
        <Select id="reminderHour" name="reminderHour" defaultValue={String(prefs.reminderHour)}>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, "0")}:00
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save preferences"}
        </Button>
        {state.status !== "idle" && (
          <p
            role={state.status === "error" ? "alert" : "status"}
            className={state.status === "error" ? "text-sm text-loss" : "text-sm text-ink-muted"}
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
