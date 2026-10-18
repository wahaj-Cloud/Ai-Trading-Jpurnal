"use server";

import { type NewsPageDto, newsQuerySchema } from "@atc/shared";
import { apiFetch } from "@/lib/api";

/** The next page of a news folder (validated with the same schema as the API). */
export async function loadMoreNewsAction(input: {
  folder: string;
  impact: string;
  cursor: string;
}): Promise<NewsPageDto | null> {
  const q = newsQuerySchema.safeParse({ ...input, limit: 40 });
  if (!q.success || !q.data.cursor) return null;
  const params = new URLSearchParams({
    folder: q.data.folder,
    impact: q.data.impact,
    cursor: q.data.cursor,
    limit: "40",
  });
  try {
    return await apiFetch<NewsPageDto>(`/v1/news?${params}`);
  } catch {
    return null;
  }
}
