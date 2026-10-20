"use server";

import type { LiveTicketDto } from "@atc/shared";
import { apiFetch } from "@/lib/api";

/** A two-minute ticket for the live order-flow stream (the plan's coins only). */
export async function getLiveTicketAction(): Promise<LiveTicketDto | null> {
  try {
    return await apiFetch<LiveTicketDto>("/v1/market/live/ticket", { method: "POST" });
  } catch {
    return null;
  }
}
