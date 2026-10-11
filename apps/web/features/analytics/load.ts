import "server-only";
import type {
  AnalyticsDto,
  AnalyticsRange,
  OpenPositionsDto,
  StrategyInsightDto,
} from "@atc/shared";
import { cache } from "react";
import { apiFetch } from "@/lib/api";

export const getAnalytics = cache((range: AnalyticsRange = "all", exchange?: string) => {
  const q = new URLSearchParams({ range });
  if (exchange) q.set("exchange", exchange);
  return apiFetch<AnalyticsDto>(`/v1/analytics?${q}`);
});

export const getStrategyInsights = cache((days: number) =>
  apiFetch<StrategyInsightDto[]>(`/v1/coach/strategy?days=${days}`),
);

export const getOpenPositions = cache(() => apiFetch<OpenPositionsDto>("/v1/open-positions"));
