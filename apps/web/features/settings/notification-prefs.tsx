"use client";

import {
  DEFAULT_EMAIL_PREFS,
  NOTIFICATION_KIND_CODES,
  NOTIFICATION_KINDS,
  type NotificationPrefs,
} from "@atc/shared";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { type FormState, savePrefsAction } from "@/features/goals/actions";

const initial: FormState = { status: "idle" };
const HOURS = Array.from({ length: 24 }, (_, h) => h);

const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function NotificationPrefsForm({
  prefs,
  timeZone,
}: {
  prefs: NotificationPrefs;
  timeZone: string;
}) {
  const [state, action, pending] = useActionState(savePrefsAction, initial);
  const [quiet, setQuiet] = useState(prefs.quietHours !== null);
  const paused = prefs.pausedUntil && Date.parse(prefs.pausedUntil) > Date.now();
  const pausedLabel = paused
    ? new Date(prefs.pausedUntil as string).toLocaleString(undefined, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
      })
    : null;
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
              {hour(h)}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">Quiet hours</legend>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="quiet"
            checked={quiet}
            onChange={(e) => setQuiet(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-coach)]"
          />
          No emails at night (they arrive when quiet hours end; the app still shows everything)
        </label>
        {quiet && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From" htmlFor="quietStart">
              <Select
                id="quietStart"
                name="quietStart"
                defaultValue={String(prefs.quietHours?.start ?? 23)}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hour(h)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Until" htmlFor="quietEnd">
              <Select
                id="quietEnd"
                name="quietEnd"
                defaultValue={String(prefs.quietHours?.end ?? 7)}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hour(h)}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-3 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="quietAllowRisk"
                defaultChecked={prefs.quietHours?.allowRisk ?? true}
                className="h-4 w-4 accent-[var(--color-coach)]"
              />
              Still email risk warnings (daily loss limit reached and the like)
            </label>
          </div>
        )}
        <p className="text-xs text-ink-faint">Hours are in your time zone ({timeZone}).</p>
      </fieldset>
      <Field
        label="Pause emails"
        htmlFor="pause"
        hint={
          pausedLabel
            ? `Paused until ${pausedLabel}. Held emails go out after that.`
            : "For a holiday or a focus day; account and billing emails still arrive"
        }
      >
        <input type="hidden" name="pausedUntil" value={paused ? (prefs.pausedUntil ?? "") : ""} />
        <Select id="pause" name="pause" defaultValue="keep">
          <option value="keep">{paused ? "Keep the current pause" : "Not paused"}</option>
          {paused && <option value="0">Resume emails now</option>}
          <option value="1">Pause for 1 hour</option>
          <option value="4">Pause for 4 hours</option>
          <option value="8">Pause for 8 hours</option>
          <option value="24">Pause for 24 hours</option>
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
