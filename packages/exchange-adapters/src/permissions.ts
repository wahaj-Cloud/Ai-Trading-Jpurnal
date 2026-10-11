/**
 * Read-only enforcement, shared by every exchange.
 *
 * Safe by default: a key is accepted only if every permission switched on is a known read permission.
 * Anything else — including permissions an exchange adds in the future — makes the key unsafe.
 */
export interface PermissionEvaluation {
  /** Read permissions we need that are switched off (user-facing names). */
  missing: string[];
  /** Permissions that let the key trade, withdraw or transfer (user-facing names). */
  unsafe: string[];
  /** Permissions we must see reported before we can call the key safe, but the exchange omitted. */
  unreported: string[];
  snapshot: Record<string, boolean>;
}

interface FlagPolicy {
  /** Flags that only allow reading. */
  readFlags: ReadonlySet<string>;
  /** Read flags that must be on. */
  requiredFlags: readonly string[];
  /** Flags that must be present in the response (e.g. withdrawals) to prove the key is safe. */
  mustReport: readonly string[];
  /** Booleans that describe the key but grant nothing (e.g. ipRestrict). */
  ignoreFlags: ReadonlySet<string>;
  labels: Record<string, string>;
}

/** For exchanges that report one boolean per permission (Binance, BingX). */
export function evaluateFlags(
  response: Record<string, unknown>,
  policy: FlagPolicy,
): PermissionEvaluation {
  const snapshot: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(response)) {
    if (typeof value === "boolean") snapshot[key] = value;
  }
  const label = (k: string) => policy.labels[k] ?? k;
  return {
    missing: policy.requiredFlags.filter((f) => snapshot[f] !== true).map(label),
    unsafe: Object.entries(snapshot)
      .filter(([k, on]) => on && !policy.readFlags.has(k) && !policy.ignoreFlags.has(k))
      .map(([k]) => label(k)),
    unreported: policy.mustReport.filter((f) => !(f in snapshot)).map(label),
    snapshot,
  };
}

interface ListPolicy {
  isReadPermission: (permission: string) => boolean;
  required: readonly string[];
  labels: Record<string, string>;
}

/** For exchanges that report a list of granted permissions (KuCoin, MEXC). */
export function evaluateList(granted: readonly string[], policy: ListPolicy): PermissionEvaluation {
  const set = new Set(granted.map((p) => p.trim()).filter(Boolean));
  const label = (p: string) => policy.labels[p] ?? p;
  return {
    missing: policy.required.filter((p) => !set.has(p)).map(label),
    unsafe: [...set].filter((p) => !policy.isReadPermission(p)).map(label),
    // A list names what is granted, so anything not listed is off: nothing can go unreported.
    unreported: [],
    snapshot: Object.fromEntries([...set].map((p) => [p, true])),
  };
}

export type PermissionProblem =
  | "UNVERIFIABLE_PERMISSIONS"
  | "UNSAFE_PERMISSIONS"
  | "MISSING_PERMISSIONS";

/** Safety problems outrank missing reads: a trading key is rejected even if it also cannot read. */
export function firstProblem(
  e: PermissionEvaluation,
): { code: PermissionProblem; details: string[] } | null {
  if (e.unreported.length > 0) return { code: "UNVERIFIABLE_PERMISSIONS", details: e.unreported };
  if (e.unsafe.length > 0) return { code: "UNSAFE_PERMISSIONS", details: e.unsafe };
  if (e.missing.length > 0) return { code: "MISSING_PERMISSIONS", details: e.missing };
  return null;
}
