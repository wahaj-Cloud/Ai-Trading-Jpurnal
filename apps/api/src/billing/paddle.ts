import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Paddle webhook signatures: header "ts=<unix>;h1=<hex HMAC-SHA256 of `${ts}:${rawBody}`>". */
export function verifyPaddleSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
  nowMs = Date.now(),
  toleranceS = 300,
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(";").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const tsRaw = String(parts.ts ?? "");
  const ts = /^\d{1,12}$/.test(tsRaw) ? Number(tsRaw) : Number.NaN;
  const signatures = header
    .split(";")
    .filter((p) => p.trim().startsWith("h1="))
    .map((p) => p.trim().slice(3));
  if (!Number.isFinite(ts) || signatures.length === 0) return false;
  // Old signatures are rejected so a captured request cannot be replayed later.
  if (Math.abs(nowMs / 1000 - ts) > toleranceS) return false;
  const expected = createHmac("sha256", secret).update(`${tsRaw}:`).update(rawBody).digest();
  return signatures.some((sig) => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/**
 * Checkout claims. The checkout runs in the browser, so its custom data could be edited; our server
 * signs the user ID instead, and a webhook trusts a userId only with a valid signature. The key is
 * derived from the webhook secret, which never leaves the server.
 */
export class CheckoutClaims {
  private readonly key: Buffer | null;
  constructor(webhookSecret: string | undefined) {
    this.key = webhookSecret
      ? createHash("sha256").update(`wickmentor-checkout-claim:${webhookSecret}`).digest()
      : null;
  }
  get enabled(): boolean {
    return this.key !== null;
  }
  sign(userId: string): string | null {
    return this.key ? createHmac("sha256", this.key).update(userId).digest("hex") : null;
  }
  verify(userId: string, claim: string | undefined): boolean {
    const expected = this.sign(userId);
    if (!expected || !claim || !/^[0-9a-f]{64}$/.test(claim)) return false;
    return timingSafeEqual(Buffer.from(claim, "hex"), Buffer.from(expected, "hex"));
  }
}

export interface PaddleSubscription {
  id: string;
  status: "active" | "trialing" | "past_due" | "paused" | "canceled";
  customer_id: string;
  items?: { price?: { id?: string } }[];
  current_billing_period?: { ends_at?: string } | null;
  scheduled_change?: { action?: string } | null;
  custom_data?: { userId?: string; claim?: string } | null;
}

export interface PaddleEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: unknown;
}

export const STATUS = {
  active: "ACTIVE",
  trialing: "TRIALING",
  past_due: "PAST_DUE",
  paused: "PAUSED",
  canceled: "CANCELED",
} as const;

/** Minimal Paddle Billing API client (customer lookup, plan changes, portal sessions). */
export class PaddleApi {
  constructor(
    private readonly apiKey: string,
    private readonly environment: "sandbox" | "production",
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private get base() {
    return this.environment === "production"
      ? "https://api.paddle.com"
      : "https://sandbox-api.paddle.com";
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchFn(`${this.base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Paddle API ${path} failed (${res.status})`);
    return ((await res.json()) as { data: T }).data;
  }

  customer(id: string): Promise<{ id: string; email: string }> {
    return this.call(`/customers/${encodeURIComponent(id)}`);
  }

  /** Switches the subscription to another price, prorated and charged immediately. */
  async changePrice(subscriptionId: string, priceId: string): Promise<void> {
    await this.call(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        items: [{ price_id: priceId, quantity: 1 }],
        proration_billing_mode: "prorated_immediately",
      }),
    });
  }

  async portalUrl(customerId: string, subscriptionId: string | null): Promise<string> {
    const data = await this.call<{ urls: { general: { overview: string } } }>(
      `/customers/${encodeURIComponent(customerId)}/portal-sessions`,
      {
        method: "POST",
        body: JSON.stringify(subscriptionId ? { subscription_ids: [subscriptionId] } : {}),
      },
    );
    return data.urls.general.overview;
  }
}

/** Paddle amounts are strings in the currency's smallest unit ("1500" = 15.00 USD). */
export function fromMinorUnits(value: unknown, currency: string): string | null {
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return null;
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    // unknown currency code: assume 2 decimals
  }
  const neg = value.startsWith("-");
  const abs = (neg ? value.slice(1) : value).padStart(digits + 1, "0");
  const major = digits ? `${abs.slice(0, -digits)}.${abs.slice(-digits)}` : abs;
  return neg ? `-${major}` : major;
}

/** Amount of a transaction.* event (null for other events). */
export function transactionAmount(event: {
  event_type: string;
  data: unknown;
}): { currency: string; total: string; earnings: string | null } | null {
  if (event.event_type.startsWith("crypto.")) {
    // Crypto invoices are priced in US dollars (major units); the coin paid is on the payment.
    const c = event.data as { price_amount?: number | string; price_currency?: string } | null;
    const usd = Number(c?.price_amount);
    if (!Number.isFinite(usd) || String(c?.price_currency ?? "").toLowerCase() !== "usd")
      return null;
    return { currency: "USD", total: usd.toFixed(2), earnings: null };
  }
  if (!event.event_type.startsWith("transaction.")) return null;
  const d = event.data as {
    currency_code?: string;
    details?: { totals?: { grand_total?: string; total?: string; earnings?: string | null } };
  } | null;
  const currency = d?.currency_code;
  const totals = d?.details?.totals;
  if (!currency || !totals) return null;
  const total = fromMinorUnits(totals.grand_total ?? totals.total, currency);
  if (total === null) return null;
  return { currency, total, earnings: fromMinorUnits(totals.earnings, currency) };
}
