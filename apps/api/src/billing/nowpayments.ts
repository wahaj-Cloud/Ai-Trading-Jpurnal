import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * NOWPayments (crypto payment gateway). The customer pays a hosted invoice in USDT, BTC, ETH and
 * many other coins; NOWPayments sends the funds to our own wallet and notifies us (IPN).
 */

/** Recursively sorts object keys: NOWPayments signs the JSON body with its keys in A→Z order. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** IPN signature: header x-nowpayments-sig = hex HMAC-SHA512(sorted JSON body, IPN secret). */
export function verifyNowPaymentsSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return false;
  }
  const expected = createHmac("sha512", secret)
    .update(JSON.stringify(sortKeys(parsed)))
    .digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function signNowPaymentsBody(body: unknown, secret: string): string {
  return createHmac("sha512", secret)
    .update(JSON.stringify(sortKeys(body)))
    .digest("hex");
}

export type NowPaymentStatus =
  | "waiting"
  | "confirming"
  | "confirmed"
  | "sending"
  | "partially_paid"
  | "finished"
  | "failed"
  | "refunded"
  | "expired";

/** Our status for each NOWPayments status. PAID only when the funds have been sent to us. */
export const CRYPTO_STATUS: Record<NowPaymentStatus, string> = {
  waiting: "WAITING",
  confirming: "CONFIRMING",
  confirmed: "CONFIRMING",
  sending: "CONFIRMING",
  partially_paid: "PARTIAL",
  finished: "PAID",
  failed: "FAILED",
  refunded: "REFUNDED",
  expired: "EXPIRED",
};

export interface NowPayment {
  payment_id: number | string;
  invoice_id?: number | string | null;
  payment_status: NowPaymentStatus;
  order_id?: string | null;
  price_amount?: number | string;
  price_currency?: string;
  pay_currency?: string;
  actually_paid?: number | string;
}

export class NowPaymentsApi {
  constructor(
    private readonly apiKey: string,
    private readonly sandbox: boolean,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private get base() {
    return this.sandbox ? "https://api-sandbox.nowpayments.io/v1" : "https://api.nowpayments.io/v1";
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchFn(`${this.base}${path}`, {
      ...init,
      headers: { "x-api-key": this.apiKey, "content-type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`NOWPayments ${path} failed (${res.status})`);
    return (await res.json()) as T;
  }

  /** A hosted invoice in US dollars; the customer picks the coin on NOWPayments' page. */
  createInvoice(input: {
    priceUsd: number;
    orderId: string;
    description: string;
    ipnUrl: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ id: string | number; invoice_url: string }> {
    return this.call("/invoice", {
      method: "POST",
      body: JSON.stringify({
        price_amount: input.priceUsd,
        price_currency: "usd",
        order_id: input.orderId,
        order_description: input.description,
        ipn_callback_url: input.ipnUrl,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        is_fixed_rate: true,
        is_fee_paid_by_user: false,
      }),
    });
  }

  /** The payment as NOWPayments records it (used to double-check every notification). */
  payment(paymentId: string): Promise<NowPayment> {
    return this.call(`/payment/${encodeURIComponent(paymentId)}`);
  }
}
