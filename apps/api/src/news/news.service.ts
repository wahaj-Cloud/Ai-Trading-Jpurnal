import type { Prisma, PrismaClient } from "@atc/db";
import type { NewsItemDto, NewsPageDto, NewsQuery } from "@atc/shared";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

type Row = Prisma.NewsItemGetPayload<object>;

/** Kept in line with the worker's toNewsDto. */
function dto(r: Row, alsoReportedBy: number): NewsItemDto {
  return {
    id: r.id,
    source: r.source as NewsItemDto["source"],
    publisher: r.publisher,
    title: r.title,
    summary: r.summary,
    url: r.url,
    publishedAt: r.publishedAt.toISOString(),
    category: r.category as NewsItemDto["category"],
    impact: r.impact as NewsItemDto["impact"],
    tags: r.tags,
    why: r.why,
    alsoReportedBy,
    reaction: (r.reaction as NewsItemDto["reaction"]) ?? null,
  };
}

/**
 * Headlines by folder, newest first, one row per story (other sources reporting it are counted).
 * "Top stories" are the High ones from every folder. Same for every user: market news, not
 * personal data.
 */
@Injectable()
export class NewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: NewsQuery): Promise<NewsPageDto> {
    const db: PrismaClient = this.prisma.client;
    const where: Prisma.NewsItemWhereInput = { clusterId: null };
    if (q.folder === "top") where.impact = "HIGH";
    else {
      where.category = q.folder;
      if (q.impact === "HIGH") where.impact = "HIGH";
      if (q.impact === "MEDIUM") where.impact = { in: ["HIGH", "MEDIUM"] };
    }
    if (q.cursor) {
      const [ms, id] = q.cursor.split(":");
      const at = new Date(Number(ms));
      where.OR = [{ publishedAt: { lt: at } }, { publishedAt: at, id: { lt: id } }];
    }
    const rows = await db.newsItem.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const counts = page.length
      ? await db.newsItem.groupBy({
          by: ["clusterId"],
          where: { clusterId: { in: page.map((r) => r.id) } },
          _count: { _all: true },
        })
      : [];
    const by = new Map(counts.map((c) => [c.clusterId, c._count._all]));
    const last = page.at(-1);
    return {
      items: page.map((r) => dto(r, by.get(r.id) ?? 0)),
      nextCursor: rows.length > q.limit && last ? `${last.publishedAt.getTime()}:${last.id}` : null,
    };
  }
}
