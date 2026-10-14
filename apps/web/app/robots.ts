import type { MetadataRoute } from "next";
import { SITE_URL } from "@/features/tools/catalog";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/tools", "/privacy", "/terms", "/risk-disclosure"],
        disallow: ["/dashboard", "/trades", "/journal", "/coach", "/admin", "/settings", "/api"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
