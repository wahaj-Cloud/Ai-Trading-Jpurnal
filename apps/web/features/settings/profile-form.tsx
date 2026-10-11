"use client";

import { BASE_CURRENCIES, type MeResponse } from "@atc/shared";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { type ProfileFormState, updateProfileAction } from "./actions";

const initial: ProfileFormState = { status: "idle" };

export function ProfileForm({ me, timezones }: { me: MeResponse; timezones: string[] }) {
  const [state, action, pending] = useActionState(updateProfileAction, initial);
  const err = state.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-8" noValidate>
      <fieldset className="grid gap-5">
        <legend className="mb-1 font-semibold">Profile</legend>
        <Field label="Display name" htmlFor="name" error={err.name}>
          <Input
            id="name"
            name="name"
            defaultValue={me.name ?? ""}
            maxLength={80}
            autoComplete="name"
            aria-invalid={Boolean(err.name)}
            aria-describedby={err.name ? "name-error" : undefined}
          />
        </Field>
        <Field
          label="Email"
          htmlFor="email"
          hint="Change your email and password from the account menu in the top bar."
        >
          <Input id="email" value={me.email} disabled readOnly aria-describedby="email-hint" />
        </Field>
      </fieldset>

      <fieldset className="grid gap-5">
        <legend className="mb-1 font-semibold">Trading preferences</legend>
        <Field
          label="Timezone"
          htmlFor="timezone"
          hint="Decides where your trading day starts and ends for daily P&L and coaching."
          error={err.timezone}
        >
          <Select
            id="timezone"
            name="timezone"
            defaultValue={me.timezone}
            aria-invalid={Boolean(err.timezone)}
            aria-describedby={err.timezone ? "timezone-error" : "timezone-hint"}
          >
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reporting currency" htmlFor="baseCurrency" error={err.baseCurrency}>
          <Select id="baseCurrency" name="baseCurrency" defaultValue={me.baseCurrency}>
            {BASE_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-2" role="radiogroup" aria-labelledby="pnl-label">
          <span id="pnl-label" className="text-sm font-medium">
            Profit and loss colours
          </span>
          <div className="grid gap-2 sm:grid-cols-2">
            <PnlOption
              value="standard"
              label="Green and red"
              profit="#26b07e"
              loss="#e5484d"
              current={me.settings.pnlColorScheme}
            />
            <PnlOption
              value="colorblind"
              label="Blue and orange (colour-blind safe)"
              profit="#4c8df6"
              loss="#f08c2e"
              current={me.settings.pnlColorScheme}
            />
          </div>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-4 border-t border-rule pt-6">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
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

function PnlOption(props: {
  value: string;
  label: string;
  profit: string;
  loss: string;
  current: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border border-rule bg-canvas px-3 py-2.5 text-sm has-checked:border-coach">
      <input
        type="radio"
        name="pnlColorScheme"
        value={props.value}
        defaultChecked={props.current === props.value}
        className="accent-[#f0b429]"
      />
      <span className="flex-1">{props.label}</span>
      <span className="figures text-xs" style={{ color: props.profit }}>
        +412.30
      </span>
      <span className="figures text-xs" style={{ color: props.loss }}>
        −96.10
      </span>
    </label>
  );
}
