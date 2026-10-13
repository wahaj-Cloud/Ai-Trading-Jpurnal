import "server-only";
import type {
  AnalyticsDto,
  AnalyticsRange,
  OpenPositionsDto,
  StrategyInsightDto,
} from "@atc/shared";
import { cache } from "react";
import {
  convertAnalytics,
  convertInsights,
  convertOpenPositions,
} from "@/features/currency/convert";
import { apiFetch } from "@/lib/api";
import { getDisplay } from "@/lib/display";

/** Amounts arrive in USD and are converted to the trader's display currency. */
export const getAnalytics = cache(async (range: AnalyticsRange = "all", exchange?: string) => {
  const q = new URLSearchParams({ range });
  if (exchange) q.set("exchange", exchange);
  const [dto, display] = await Promise.all([
    apiFetch<AnalyticsDto>(`/v1/analytics?${q}`),
    getDisplay(),
  ]);
  return convertAnalytics(dto, display);
});

export const getStrategyInsights = cache(async (days: number) => {
  const [list, display] = await Promise.all([
    apiFetch<StrategyInsightDto[]>(`/v1/coach/strategy?days=${days}`),
    getDisplay(),
  ]);
  return convertInsights(list, display);
});

export const getOpenPositions = cache(async () => {
  const [dto, display] = await Promise.all([
    apiFetch<OpenPositionsDto>("/v1/open-positions"),
    getDisplay(),
  ]);
  return convertOpenPositions(dto, display);
});
