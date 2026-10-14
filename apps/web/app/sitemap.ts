import type { MetadataRoute } from "next";
import { PUBLIC_TOOLS, SITE_URL } from "@/features/tools/catalog";

/** Public pages for search engines (the app itself is behind sign-in). */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/tools`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    ...PUBLIC_TOOLS.map((t) => ({
      url: `${SITE_URL}/tools/${t.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: t.slug === "trade-grader" ? 0.9 : 0.7,
    })),
    ...["privacy", "terms", "risk-disclosure"].map((p) => ({
      url: `${SITE_URL}/${p}`,
      lastModified: now,
      changeFrequency: "yearly" as const,
      priority: 0.2,
    })),
  ];
}
