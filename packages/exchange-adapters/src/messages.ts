import { EXCHANGE_CATALOG, type ExchangeId } from "@atc/shared";
import type { VerificationFailure, VerificationFailureCode } from "./types.js";

/** User-facing failure messages. Every message says what happened and what to do next. */
export function failure(
  exchange: ExchangeId,
  code: VerificationFailureCode,
  details?: string[],
): VerificationFailure {
  const { name, product } = EXCHANGE_CATALOG[exchange];
  const messages: Record<VerificationFailureCode, string> = {
    INVALID_KEY: `${name} rejected this API Key. Check you copied it in full and that the key still exists. If the key is locked to trusted IPs, add our IP addresses shown on this page.`,
    INVALID_SECRET: `The Secret Key does not match this API Key. Copy both again from ${name}.`,
    INVALID_PASSPHRASE: `The passphrase does not match this key. Use the passphrase you set when you created the key on ${name}.`,
    IP_NOT_ALLOWED: `This key only works from other IP addresses. On ${name}, add our IP addresses shown on this page to the key, then try again.`,
    KEY_EXPIRED: `This key has expired or been frozen on ${name}. Create a new read-only key and connect it.`,
    MISSING_PERMISSIONS: `This key cannot read everything we need. On ${name}, turn on the permissions listed, then try again.`,
    UNSAFE_PERMISSIONS: `For your safety we only accept read-only keys. On ${name}, turn off the permissions listed, or create a new key with read access only.`,
    FUTURES_UNAVAILABLE: `This ${name} account has no ${product} access. Open a futures account on ${name}, then try again.`,
    ACCOUNT_RESTRICTED: `${name} is restricting this account, for example for identity verification or region. Check your account status on ${name}.`,
    RATE_LIMITED: `${name} is limiting requests. Wait a minute and try again.`,
    RESTRICTED_LOCATION: `${name} is temporarily unavailable from our servers. Please try again later.`,
    UNVERIFIABLE_PERMISSIONS: `We could not confirm with ${name} that this key is read-only, so we did not save it. Please try again later.`,
    EXCHANGE_UNAVAILABLE: `We could not reach ${name} to check this key. Please try again in a few minutes.`,
  };
  // Unreported permission names are our diagnostic, not something the user can act on.
  const shown = code === "UNVERIFIABLE_PERMISSIONS" ? undefined : details;
  return { ok: false, code, message: messages[code], ...(shown?.length ? { details: shown } : {}) };
}
