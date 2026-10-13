import "server-only";
import type {
  BehaviourSummaryDto,
  CoachNoteDto,
  CoachStatusDto,
  ConversationDto,
  ConversationSummaryDto,
  ReviewedTradeDto,
} from "@atc/shared";
import { cache } from "react";
import { convertBehaviour, convertReviews } from "@/features/currency/convert";
import { apiFetch } from "@/lib/api";
import { getDisplay } from "@/lib/display";

export const getCoachStatus = cache(() => apiFetch<CoachStatusDto>("/v1/coach/status"));
export const getBehaviour = cache(async (days: 7 | 30 | 90 = 30) => {
  const [dto, display] = await Promise.all([
    apiFetch<BehaviourSummaryDto>(`/v1/coach/behaviour?days=${days}`),
    getDisplay(),
  ]);
  return convertBehaviour(dto, display);
});
export const getNotes = cache((limit = 20) =>
  apiFetch<CoachNoteDto[]>(`/v1/coach/notes?limit=${limit}`),
);
export const getReviews = cache(async (limit = 20) => {
  const [list, display] = await Promise.all([
    apiFetch<ReviewedTradeDto[]>(`/v1/coach/reviews?limit=${limit}`),
    getDisplay(),
  ]);
  return convertReviews(list, display);
});
export const getConversations = cache(() =>
  apiFetch<ConversationSummaryDto[]>("/v1/coach/conversations"),
);
export const getConversation = (id: string) =>
  apiFetch<ConversationDto>(`/v1/coach/conversations/${id}`);
