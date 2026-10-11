"use client";

import { EXCHANGE_CATALOG, type ExchangeId } from "@atc/shared";
import { Eye, EyeOff } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { KeyFormState } from "./actions";

type Action = (prev: KeyFormState, formData: FormData) => Promise<KeyFormState>;

const initial: KeyFormState = { status: "idle" };

const secretProps = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
} as const;

/** Shared by "connect" and "replace key". Secrets are never pre-filled or echoed back. */
export function KeyForm({
  exchange,
  action,
  defaultLabel,
  submitLabel,
}: {
  exchange: ExchangeId;
  action: Action;
  /** Omit to hide the name field (replacing a key keeps the connection's name). */
  defaultLabel?: string;
  submitLabel: string;
}) {
  const info = EXCHANGE_CATALOG[exchange];
  const [state, formAction, pending] = useActionState(action, initial);
  const err = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      {state.status === "error" && state.message && (
        <div
          role="alert"
          className="rounded-[var(--radius-control)] border border-loss/40 bg-loss/10 p-4 text-sm"
        >
          <p className="text-ink">{state.message}</p>
          {state.details && state.details.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-ink-muted">
              {state.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {defaultLabel !== undefined && (
        <Field
          label="Connection name"
          htmlFor="label"
          hint='For example "Main account".'
          error={err.label}
        >
          <Input
            id="label"
            name="label"
            maxLength={40}
            defaultValue={state.label ?? defaultLabel}
            aria-invalid={Boolean(err.label)}
            aria-describedby={err.label ? "label-error" : "label-hint"}
          />
        </Field>
      )}

      {info.kind === "METATRADER" ? (
        <MetatraderFields
          serverExample={info.serverExample ?? ""}
          brokerName={info.name}
          err={err}
        />
      ) : (
        <ApiKeyFields info={info} err={err} />
      )}

      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Button type="submit" disabled={pending}>
          {pending
            ? info.kind === "METATRADER"
              ? "Saving…"
              : `Checking key with ${info.name}…`
            : submitLabel}
        </Button>
        <p className="text-sm text-ink-faint">
          {info.kind === "METATRADER"
            ? "We confirm it is the read-only investor password before importing anything."
            : "We check the key is read-only before saving anything."}
        </p>
      </div>
    </form>
  );
}

function ApiKeyFields({
  info,
  err,
}: {
  info: (typeof EXCHANGE_CATALOG)[ExchangeId];
  err: Record<string, string>;
}) {
  return (
    <>
      <Field label="API Key" htmlFor="apiKey" error={err.apiKey}>
        <Input
          id="apiKey"
          name="apiKey"
          required
          className="font-mono"
          {...secretProps}
          aria-invalid={Boolean(err.apiKey)}
          aria-describedby={err.apiKey ? "apiKey-error" : undefined}
        />
      </Field>

      <SecretField
        id="apiSecret"
        label="Secret Key"
        hint="Encrypted before it is stored. You will not be able to view it again."
        error={err.apiSecret}
      />

      {info.needsPassphrase && (
        <SecretField
          id="passphrase"
          label="API passphrase"
          hint={`The passphrase you chose when creating the key on ${info.name}. Also encrypted.`}
          error={err.passphrase}
        />
      )}
    </>
  );
}

function MetatraderFields({
  serverExample,
  brokerName,
  err,
}: {
  serverExample: string;
  brokerName: string;
  err: Record<string, string>;
}) {
  return (
    <>
      <Field
        label="Platform"
        htmlFor="platform"
        hint="The MetaTrader version of this account."
        error={err.platform}
      >
        <select
          id="platform"
          name="platform"
          defaultValue="mt5"
          className="h-10 w-full rounded-[var(--radius-control)] border border-rule bg-canvas px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-coach"
          aria-describedby="platform-hint"
        >
          <option value="mt5">MetaTrader 5</option>
          <option value="mt4">MetaTrader 4</option>
        </select>
      </Field>
      <Field
        label="Account number"
        htmlFor="login"
        hint={`Your ${brokerName} MetaTrader account number (login).`}
        error={err.login}
      >
        <Input
          id="login"
          name="login"
          inputMode="numeric"
          required
          className="font-mono"
          {...secretProps}
          aria-invalid={Boolean(err.login)}
          aria-describedby={err.login ? "login-error" : "login-hint"}
        />
      </Field>
      <Field
        label="Server"
        htmlFor="server"
        hint={`Exactly as ${brokerName} shows it, for example ${serverExample}.`}
        error={err.server}
      >
        <Input
          id="server"
          name="server"
          required
          placeholder={serverExample}
          className="font-mono"
          {...secretProps}
          aria-invalid={Boolean(err.server)}
          aria-describedby={err.server ? "server-error" : "server-hint"}
        />
      </Field>
      <SecretField
        id="password"
        label="Investor password (read-only)"
        hint="Not your trading password. It is encrypted, used once to log in, then deleted."
        error={err.password}
      />
    </>
  );
}

function SecretField({
  id,
  label,
  hint,
  error,
}: {
  id: string;
  label: string;
  hint: string;
  error?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint}>
      <div className="relative">
        <Input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          required
          className="pr-11 font-mono"
          {...secretProps}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-muted hover:text-ink"
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </Field>
  );
}
