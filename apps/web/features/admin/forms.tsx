"use client";

import type { AdminPlanCostRow } from "@atc/shared";
import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import {
  type AdminFormState,
  changePlanAction,
  createAnnouncementAction,
  endAnnouncementAction,
  foundingMemberAction,
  suspendAction,
  updatePlanAction,
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

export function FoundingMemberForm({ userId, founding }: { userId: string; founding: boolean }) {
  const [state, action, pending] = useActionState(foundingMemberAction.bind(null, userId), initial);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="foundingMember" value={founding ? "false" : "true"} />
      <p className="text-sm text-ink-muted">
        {founding
          ? "This user has the Founding Member badge."
          : "Give early supporters a Founding Member badge (shown on their profile)."}
      </p>
      <div>
        <Button
          type="submit"
          size="sm"
          variant={founding ? "secondary" : "primary"}
          disabled={pending}
        >
          {founding ? "Remove badge" : "Mark as founding member"}
        </Button>
      </div>
      <Msg s={state} />
    </form>
  );
}

const LIMIT_FIELDS: Array<{
  name: keyof AdminPlanCostRow["limits"];
  label: string;
  step?: string;
}> = [
  { name: "aiBudgetUsd", label: "AI budget $/month", step: "0.01" },
  { name: "coachMessagesPerDay", label: "Coach questions/day" },
  { name: "aiReviewsPerMonth", label: "AI reviews/month" },
  { name: "exchangeAccounts", label: "Exchange connections" },
  { name: "brokerAccounts", label: "Exness accounts" },
  { name: "historyDays", label: "History days" },
  { name: "setups", label: "Saved setups" },
  { name: "setupAlertEmail", label: "Alert emails (0/1)" },
  { name: "whatIf", label: "What-If Lab (0/1)" },
  { name: "backtestRunsPerMonth", label: "Backtests/month" },
  { name: "backtestHistoryMonths", label: "Backtest months" },
  { name: "marketPulseCoins", label: "Pulse coins" },
  { name: "marketPulseAllWindows", label: "Pulse 7d/30d (0/1)" },
  { name: "liquidationMap", label: "Liq. map all markets (0/1)" },
  { name: "marketDesk", label: "Desk all markets (0/1)" },
  { name: "scalpAlerts", label: "Scalp alerts" },
  { name: "paperBots", label: "Paper bots" },
  { name: "zoneAlerts", label: "Zone alerts" },
];

/** One plan's price and limits; -1 means unlimited. */
export function PlanLimitsForm({ plan }: { plan: AdminPlanCostRow }) {
  const [state, action, pending] = useActionState(updatePlanAction.bind(null, plan.code), initial);
  return (
    <form action={action} className="grid gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Field label="Price $/month" htmlFor={`${plan.code}-price`}>
          <Input
            id={`${plan.code}-price`}
            name="priceUsd"
            type="number"
            min={0}
            step="0.01"
            defaultValue={plan.priceUsd ?? ""}
            placeholder="not set"
          />
        </Field>
        {LIMIT_FIELDS.map((f) => (
          <Field key={f.name} label={f.label} htmlFor={`${plan.code}-${f.name}`}>
            <Input
              id={`${plan.code}-${f.name}`}
              name={f.name}
              type="number"
              min={-1}
              step={f.step ?? "1"}
              required
              defaultValue={plan.limits[f.name]}
            />
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Save {plan.name}
        </Button>
        <span className="text-xs text-ink-faint">-1 = unlimited</span>
        <Msg s={state} />
      </div>
    </form>
  );
}
