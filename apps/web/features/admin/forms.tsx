"use client";

import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import {
  type AdminFormState,
  changePlanAction,
  createAnnouncementAction,
  endAnnouncementAction,
  suspendAction,
} from "./actions";

const initial: AdminFormState = { status: "idle" };
const Msg = ({ s }: { s: AdminFormState }) =>
  s.status === "idle" ? null : (
    <p
      role={s.status === "error" ? "alert" : "status"}
      className={s.status === "error" ? "text-sm text-loss" : "text-sm text-ink-muted"}
    >
      {s.message}
    </p>
  );

export function PlanForm({ userId, current }: { userId: string; current: string }) {
  const [state, action, pending] = useActionState(changePlanAction.bind(null, userId), initial);
  return (
    <form action={action} className="grid gap-3">
      <Field label="Plan" htmlFor="planCode">
        <Select id="planCode" name="planCode" defaultValue={current}>
          {["FREE", "PRO", "PREMIUM", "ENTERPRISE"].map((p) => (
            <option key={p} value={p}>
              {p.charAt(0) + p.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Reason (kept in the audit log)" htmlFor="reason">
        <Input id="reason" name="reason" required minLength={3} maxLength={300} />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Change plan"}
        </Button>
        <Msg s={state} />
      </div>
    </form>
  );
}

export function SuspendForm({ userId, suspended }: { userId: string; suspended: boolean }) {
  const [state, action, pending] = useActionState(suspendAction.bind(null, userId), initial);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="suspended" value={suspended ? "false" : "true"} />
      <Field label="Reason (kept in the audit log)" htmlFor="suspend-reason">
        <Input id="suspend-reason" name="reason" required minLength={3} maxLength={300} />
      </Field>
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          size="sm"
          variant={suspended ? "secondary" : "ghost"}
          disabled={pending}
        >
          {pending ? "Saving…" : suspended ? "Restore account" : "Suspend account"}
        </Button>
        <Msg s={state} />
      </div>
    </form>
  );
}

export function AnnouncementForm() {
  const [state, action, pending] = useActionState(createAnnouncementAction, initial);
  return (
    <form action={action} className="grid gap-3">
      <Field label="Title" htmlFor="title">
        <Input id="title" name="title" required maxLength={120} />
      </Field>
      <Field label="Message" htmlFor="body">
        <textarea
          id="body"
          name="body"
          required
          maxLength={1000}
          rows={3}
          className="w-full rounded-[var(--radius-control)] border border-rule bg-canvas px-3 py-2 text-sm text-ink focus:border-coach focus:outline-none"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type" htmlFor="level">
          <Select id="level" name="level" defaultValue="INFO">
            <option value="INFO">Information</option>
            <option value="WARNING">Warning</option>
          </Select>
        </Field>
        <Field label="Ends (optional)" htmlFor="endsAt">
          <Input id="endsAt" name="endsAt" type="datetime-local" />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Publishing…" : "Publish to all users"}
        </Button>
        <Msg s={state} />
      </div>
    </form>
  );
}

export function EndAnnouncementButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => start(() => endAnnouncementAction(id))}
    >
      {pending ? "Ending…" : "End now"}
    </Button>
  );
}
