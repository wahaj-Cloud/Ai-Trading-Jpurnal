import { createHmac, timingSafeEqual } from "node:crypto";

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
  const ts = Number(parts.ts);
  const signatures = header
    .split(";")
    .filter((p) => p.trim().startsWith("h1="))
    .map((p) => p.trim().slice(3));
  if (!Number.isFinite(ts) || signatures.length === 0) return false;
  // Old signatures are rejected so a captured request cannot be replayed later.
  if (Math.abs(nowMs / 1000 - ts) > toleranceS) return false;
  const expected = createHmac("sha256", secret).update(`${ts}:`).update(rawBody).digest();
  return signatures.some((sig) => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export interface PaddleSubscription {
  id: string;
  status: "active" | "trialing" | "past_due" | "paused" | "canceled";
  customer_id: string;
  items?: { price?: { id?: string } }[];
  current_billing_period?: { ends_at?: string } | null;
  scheduled_change?: { action?: string } | null;
  custom_data?: { userId?: string } | null;
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
