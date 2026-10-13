"use client";

import { type MeResponse, POPULAR_CURRENCIES } from "@atc/shared";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import type { Display } from "@/features/currency/convert";
import { cn } from "@/lib/cn";
import { type ProfileFormState, updateProfileAction } from "./actions";

const initial: ProfileFormState = { status: "idle" };

const POPULAR: ReadonlySet<string> = new Set(POPULAR_CURRENCIES);
const rateDate = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export function ProfileForm({
  me,
  timezones,
  currencies,
  display,
}: {
  me: MeResponse;
  timezones: string[];
  /** Codes with their English names, named on the server so both renders match. */
  currencies: Array<{ code: string; name: string }>;
  display: Display;
}) {
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
        <Field
          label="Show amounts in"
          htmlFor="displayCurrency"
          error={err.displayCurrency}
          hint={
            display.unavailable
              ? `No exchange rate for ${display.unavailable} yet, so amounts show in USD for now.`
              : display.code !== "USD" && display.asOf
                ? `1 USD = ${display.rate.toLocaleString("en", { maximumFractionDigits: 4 })} ${display.code}, rates of ${rateDate.format(new Date(display.asOf))}. Rates update every day; all amounts use the latest rate.`
                : "Trades are recorded in USD. Pick another currency to see every amount converted at the latest daily rate."
          }
        >
          <Select id="displayCurrency" name="displayCurrency" defaultValue={me.displayCurrency}>
            {[
              { label: "Popular", list: currencies.filter((c) => POPULAR.has(c.code)) },
              { label: "All currencies", list: currencies.filter((c) => !POPULAR.has(c.code)) },
            ].map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.list.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        {display.code !== "USD" && (
          <p className="-mt-3 text-xs text-ink-faint">
            <a
              href="https://www.exchangerate-api.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-ink"
            >
              Rates by Exchange Rate API
            </a>
          </p>
        )}
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
        className="accent-[#4d94ff]"
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
