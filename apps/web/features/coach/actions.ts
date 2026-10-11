"use server";

import {
  type ChatInput,
  type CoachNoteDto,
  type ConversationDto,
  chatInputSchema,
} from "@atc/shared";
import { revalidatePath } from "next/cache";
import { ApiError, apiFetch } from "@/lib/api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const message = (err: unknown, fallback: string) =>
  err instanceof ApiError && err.body?.message && err.status < 500
    ? err.body.message
    : err instanceof ApiError && (err.status === 502 || err.status === 503)
      ? (err.body?.message ?? fallback)
      : fallback;

export async function requestReviewAction(
  positionId: string,
  force: boolean,
): Promise<{ error?: string }> {
  if (!UUID.test(positionId)) return { error: "Unknown trade." };
  try {
    await apiFetch(`/v1/positions/${positionId}/review`, {
      method: "POST",
      body: JSON.stringify({ force: Boolean(force) }),
    });
  } catch (err) {
    return { error: message(err, "Could not start the review. Try again shortly.") };
  }
  revalidatePath(`/trades/${positionId}`);
  return {};
}

export async function sendChatAction(
  input: ChatInput,
): Promise<{ conversation?: ConversationDto; error?: string }> {
  const parsed = chatInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid message" };
  try {
    const conversation = await apiFetch<ConversationDto>("/v1/coach/chat", {
      method: "POST",
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(90_000),
    });
    revalidatePath("/coach");
    return { conversation };
  } catch (err) {
    return { error: message(err, "The coach could not answer right now. Try again in a minute.") };
  }
}

export async function deleteConversationAction(id: string): Promise<{ error?: string }> {
  if (!UUID.test(id)) return { error: "Unknown conversation." };
  try {
    await apiFetch(`/v1/coach/conversations/${id}`, { method: "DELETE" });
  } catch (err) {
    return { error: message(err, "Could not delete the conversation.") };
  }
  revalidatePath("/coach");
  return {};
}

export async function coachDayAction(
  date: string,
): Promise<{ note?: CoachNoteDto | null; error?: string }> {
  if (!DAY.test(date)) return { error: "Choose a valid day." };
  try {
    const note = await apiFetch<CoachNoteDto | undefined>("/v1/coach/notes/daily", {
      method: "POST",
      body: JSON.stringify({ date }),
      signal: AbortSignal.timeout(90_000),
    });
    revalidatePath("/coach");
    revalidatePath("/dashboard");
    revalidatePath("/journal");
    return { note: note ?? null };
  } catch (err) {
    return { error: message(err, "Could not write the note right now. Try again in a minute.") };
  }
}
