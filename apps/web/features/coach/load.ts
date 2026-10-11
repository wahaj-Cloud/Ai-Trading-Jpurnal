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
import { apiFetch } from "@/lib/api";

export const getCoachStatus = cache(() => apiFetch<CoachStatusDto>("/v1/coach/status"));
export const getBehaviour = cache((days: 7 | 30 | 90 = 30) =>
  apiFetch<BehaviourSummaryDto>(`/v1/coach/behaviour?days=${days}`),
);
export const getNotes = cache((limit = 20) =>
  apiFetch<CoachNoteDto[]>(`/v1/coach/notes?limit=${limit}`),
);
export const getReviews = cache((limit = 20) =>
  apiFetch<ReviewedTradeDto[]>(`/v1/coach/reviews?limit=${limit}`),
);
export const getConversations = cache(() =>
  apiFetch<ConversationSummaryDto[]>("/v1/coach/conversations"),
);
export const getConversation = (id: string) =>
  apiFetch<ConversationDto>(`/v1/coach/conversations/${id}`);
