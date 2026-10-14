"use server";

import { type HelpAnswerDto, type HelpAskInput, helpAskSchema } from "@atc/shared";
import { ApiError, apiFetch } from "@/lib/api";

/** Asks the help assistant. Errors come back as a friendly answer, never a crash. */
export async function askHelpAction(input: HelpAskInput): Promise<HelpAnswerDto> {
  const parsed = helpAskSchema.safeParse(input);
  if (!parsed.success) {
    return { answer: "Please ask a shorter question (up to 500 characters).", links: [] };
  }
  try {
    return await apiFetch<HelpAnswerDto>("/v1/coach/help", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
  } catch (err) {
    const busy = err instanceof ApiError && err.status === 429;
    return {
      answer: busy
        ? "You're asking quickly — give me a few seconds and try again."
        : "I can't answer right now. Please try again in a minute, or open the Help page.",
      links: [{ label: "Help", href: "/help" }],
    };
  }
}
