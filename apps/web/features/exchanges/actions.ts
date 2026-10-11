"use server";

import {
  connectExchangeSchema,
  credentialsSchema,
  EXCHANGE_CATALOG,
  type ExchangeId,
  isExchangeId,
  metatraderCredentialsSchema,
} from "@atc/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api";
import { afterCurrent, buildQueue } from "./queue";

export interface KeyFormState {
  status: "idle" | "error";
  message?: string;
  /** Specific items to fix, e.g. permissions that must be switched off. */
  details?: string[];
  fieldErrors?: Record<string, string>;
  /** Non-secret values echoed back so the user does not retype them. Secrets are never echoed. */
  label?: string;
}

function fromForm(formData: FormData) {
  const passphrase = formData.get("passphrase");
  return {
    label: String(formData.get("label") ?? ""),
    apiKey: String(formData.get("apiKey") ?? ""),
    apiSecret: String(formData.get("apiSecret") ?? ""),
    // Absent field (exchanges without passphrases) stays undefined; an empty field is an error.
    ...(passphrase === null ? {} : { passphrase: String(passphrase) }),
  };
}

/** MetaTrader brokers: account number, investor password, server and platform. */
function metatraderFromForm(formData: FormData) {
  return {
    login: String(formData.get("login") ?? ""),
    password: String(formData.get("password") ?? ""),
    server: String(formData.get("server") ?? ""),
    platform: String(formData.get("platform") ?? "mt5"),
  };
}

/** The request body for the venue: API-key fields or MetaTrader login fields, never both. */
function credentialsFor(exchange: ExchangeId, formData: FormData) {
  if (EXCHANGE_CATALOG[exchange].kind === "METATRADER") return metatraderFromForm(formData);
  const { label: _label, ...keys } = fromForm(formData);
  return keys;
}

function validationState(
  issues: { path: PropertyKey[]; message: string }[],
  label?: string,
): KeyFormState {
  const fieldErrors: Record<string, string> = {};
  for (const i of issues) fieldErrors[String(i.path[0] ?? "form")] ??= i.message;
  return { status: "error", message: "Check the highlighted fields.", fieldErrors, label };
}

function apiErrorState(err: unknown, label?: string): KeyFormState {
  if (err instanceof ApiError && err.body) {
    const passphraseIssue = err.body.issues?.find((i) => i.path === "passphrase");
    return {
      status: "error",
      message: err.body.message,
      details: err.body.issues?.filter((i) => i.path !== "passphrase").map((i) => i.message),
      ...(passphraseIssue ? { fieldErrors: { passphrase: passphraseIssue.message } } : {}),
      label,
    };
  }
  return {
    status: "error",
    message: "We could not save this connection. Try again in a moment.",
    label,
  };
}

/**
 * Bound per page with the exchange and the connect queue. Bound arguments reach the server from
 * the browser, so both are re-validated here rather than trusted.
 */
export async function connectExchangeAction(
  exchange: ExchangeId,
  queueParams: { q?: string; done?: string },
  _prev: KeyFormState,
  formData: FormData,
): Promise<KeyFormState> {
  if (!isExchangeId(exchange))
    return { status: "error", message: "Choose an exchange to connect." };
  const raw = {
    exchange,
    label: String(formData.get("label") ?? ""),
    ...credentialsFor(exchange, formData),
  };
  const parsed = connectExchangeSchema.safeParse(raw);
  if (!parsed.success) return validationState(parsed.error.issues, raw.label);

  try {
    await apiFetch("/v1/exchange-accounts", { method: "POST", body: JSON.stringify(parsed.data) });
  } catch (err) {
    return apiErrorState(err, raw.label);
  }
  revalidatePath("/", "layout");
  redirect(afterCurrent(buildQueue(exchange, queueParams.q, queueParams.done), true));
}

export async function replaceKeyAction(
  accountId: string,
  exchange: ExchangeId,
  _prev: KeyFormState,
  formData: FormData,
): Promise<KeyFormState> {
  if (!isExchangeId(exchange)) return { status: "error", message: "Unknown exchange." };
  const body = credentialsFor(exchange, formData);
  const parsed =
    EXCHANGE_CATALOG[exchange].kind === "METATRADER"
      ? metatraderCredentialsSchema.safeParse(body)
      : credentialsSchema.safeParse(body);
  if (!parsed.success) return validationState(parsed.error.issues);

  try {
    await apiFetch(`/v1/exchange-accounts/${encodeURIComponent(accountId)}/credentials`, {
      method: "PUT",
      body: JSON.stringify(parsed.data),
    });
  } catch (err) {
    return apiErrorState(err);
  }
  revalidatePath("/", "layout");
  redirect("/exchanges?updated=1");
}

export async function disconnectAction(accountId: string): Promise<{ error?: string }> {
  try {
    await apiFetch(`/v1/exchange-accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" });
  } catch {
    return { error: "Could not disconnect. Try again in a moment." };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function syncNowAction(accountId: string): Promise<{ error?: string }> {
  try {
    await apiFetch(`/v1/exchange-accounts/${encodeURIComponent(accountId)}/sync`, {
      method: "POST",
    });
  } catch (err) {
    return {
      error:
        err instanceof ApiError && err.status === 429
          ? "You synced recently. Try again in a minute."
          : err instanceof ApiError && err.body?.message
            ? err.body.message
            : "Could not start a sync. Try again in a moment.",
    };
  }
  revalidatePath("/exchanges");
  return {};
}
