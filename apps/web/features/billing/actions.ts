"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api";

export async function openPortalAction(): Promise<{ error?: string }> {
  let url: string;
  try {
    ({ url } = await apiFetch<{ url: string }>("/v1/billing/portal", { method: "POST" }));
  } catch (err) {
    return {
      error:
        err instanceof ApiError && err.body?.message
          ? err.body.message
          : "Could not open billing. Try again.",
    };
  }
  // Only ever redirect to Paddle's own portal.
  const host = new URL(url).hostname;
  if (!/(^|\.)paddle\.com$/.test(host)) return { error: "Unexpected billing address." };
  redirect(url);
}

/** Moves the live subscription to another price (prorated by Paddle). */
export async function changePlanAction(priceId: string): Promise<{ error?: string; ok?: true }> {
  if (!/^pri_[a-z0-9]{6,64}$/i.test(priceId)) return { error: "Unknown price." };
  try {
    await apiFetch("/v1/billing/change-plan", {
      method: "POST",
      body: JSON.stringify({ priceId }),
    });
  } catch (err) {
    return {
      error:
        err instanceof ApiError && err.body?.message
          ? err.body.message
          : "Could not change your plan. Try again.",
    };
  }
  revalidatePath("/billing");
  return { ok: true };
}

/** Opens a NOWPayments crypto invoice for a fixed period of a plan. */
export async function cryptoCheckoutAction(
  plan: "PRO" | "PREMIUM",
  interval: "month" | "year",
): Promise<{ error?: string }> {
  let url: string;
  try {
    ({ url } = await apiFetch<{ url: string }>("/v1/billing/crypto/checkout", {
      method: "POST",
      body: JSON.stringify({ plan, interval }),
    }));
  } catch (err) {
    return {
      error:
        err instanceof ApiError && err.body?.message
          ? err.body.message
          : "Could not open the crypto payment page. Try again.",
    };
  }
  // Only ever redirect to NOWPayments' own payment page.
  const u = new URL(url);
  if (u.protocol !== "https:" || !/(^|\.)nowpayments\.io$/.test(u.hostname))
    return { error: "Unexpected payment address." };
  redirect(u.toString());
}
