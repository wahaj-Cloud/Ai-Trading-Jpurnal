import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@atc/db";
import {
  type BinanceClientOptions,
  CENTRAL_BANK_FEEDS,
  FINNHUB_CATEGORIES,
  type FinnhubCategory,
  fetchBinanceMinuteCandles,
  fetchCentralBankFeed,
  fetchFinnhubNews,
  fetchGdelt,
  type RawHeadline,
} from "@atc/exchange-adapters";
import {
  classifyHeadline,
  headlineSimilarity,
  headlineWords,
  NEWS_LIVE_CHANNEL,
  NEWS_RETENTION_DAYS,
  type NewsCategory,
  type NewsImpact,
  type NewsItemDto,
  type NewsLiveUpdate,
  type NewsReactionDto,
  type NewsSource,
  priceReaction,
  SAME_STORY,
} from "@atc/shared";
import { log } from "../logger.js";

const MIN = 60_000;
const H = 60 * MIN;
const LOCK_KEY = "news:leader";
const LOCK_TTL_MS = 45_000;
const IMPACT_RANK: Record<NewsImpact, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export interface NewsRedis {
  publish(channel: string, message: string): Promise<unknown>;
  set(key: string, value: string, px: "PX", ttl: number, nx: "NX"): Promise<unknown>;
  eval(script: string, keys: number, ...args: (string | number)[]): Promise<unknown>;
}

export interface HeadlineDeps {
  db: PrismaClient;
  redis: NewsRedis;
  /** Free Finnhub key (finnhub.io); without it, Finnhub is skipped. */
  finnhubKey?: string;
  binance?: BinanceClientOptions;
  fetchFn?: typeof fetch;
  now?: () => number;
}

type Row = Prisma.NewsItemGetPayload<object>;

export function toNewsDto(r: Row, alsoReportedBy = 0): NewsItemDto {
  return {
    id: r.id,
    source: r.source as NewsSource,
    publisher: r.publisher,
    title: r.title,
    summary: r.summary,
    url: r.url,
    publishedAt: r.publishedAt.toISOString(),
    category: r.category as NewsCategory,
    impact: r.impact as NewsImpact,
    tags: r.tags,
    why: r.why,
    alsoReportedBy,
    reaction: (r.reaction as NewsReactionDto | null) ?? null,
  };
}

/**
 * Collects headlines from every source, sorts and rates them, groups reports of the same story,
 * stores them and pushes each new Medium or High one to every open browser within a second.
 * Also measures how Bitcoin and gold moved 15 and 60 minutes after each High headline.
 * One worker collects at a time (Redis lock), so API quotas are never spent twice.
 */
export class HeadlineCollector {
  private readonly token = randomUUID();
  private leader = false;
  private stopped = false;
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly minId = new Map<FinnhubCategory, number>();
  private readonly now: () => number;

  constructor(private readonly deps: HeadlineDeps) {
    this.now = deps.now ?? Date.now;
  }

  private get opts() {
    return this.deps.fetchFn ? { fetch: this.deps.fetchFn } : {};
  }

  /** Classifies, stores and announces headlines. Returns the stories that were new. */
  async ingest(raw: RawHeadline[]): Promise<NewsItemDto[]> {
    const now = this.now();
    const fresh = raw.filter(
      (h) => h.publishedAt <= now + 5 * MIN && h.publishedAt >= now - 48 * H && h.title.length >= 8,
    );
    if (fresh.length === 0) return [];
    const rows = fresh
      .map((h) => {
        const c = classifyHeadline({
          title: h.title,
          summary: h.summary,
          source: h.source,
          sourceCategory: h.sourceCategory,
          importance: h.importance,
          monetaryPolicy: h.monetaryPolicy,
        });
        return { h, c };
      })
      // GDELT is a wide net: only what our rules rate Medium or High is kept from it.
      .filter(({ h, c }) => h.source !== "GDELT" || c.impact !== "LOW")
      .map(({ h, c }) => ({
        source: h.source,
        sourceId: h.sourceId.slice(0, 200),
        title: h.title.slice(0, 500),
        summary: h.summary?.slice(0, 2000) ?? null,
        url: h.url?.slice(0, 1000) ?? null,
        publisher: h.publisher.slice(0, 120),
        publishedAt: new Date(h.publishedAt),
        receivedAt: new Date(now),
        category: c.category,
        impact: c.impact,
        tags: c.tags,
        why: c.why,
      }));
    if (rows.length === 0) return [];
    // Only rows that were not stored before come back, so nothing is announced twice.
    const inserted = (
      await this.deps.db.newsItem.createManyAndReturn({ data: rows, skipDuplicates: true })
    ).sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
    if (inserted.length === 0) return [];

    const leaders = await this.deps.db.newsItem.findMany({
      where: {
        clusterId: null,
        publishedAt: { gte: new Date(now - 6 * H) },
        id: { notIn: inserted.map((r) => r.id) },
      },
      orderBy: { publishedAt: "desc" },
      take: 600,
    });
    const pool = leaders.map((l) => ({ row: l, words: headlineWords(l.title) }));
    const announce: Row[] = [];
    for (const r of inserted) {
      const words = headlineWords(r.title);
      let best: (typeof pool)[number] | null = null;
      let bestScore = 0;
      for (const p of pool) {
        const s = headlineSimilarity(words, p.words);
        if (s >= SAME_STORY && s > bestScore) {
          best = p;
          bestScore = s;
        }
      }
      if (!best) {
        pool.push({ row: r, words });
        if (r.impact !== "LOW") announce.push(r);
        continue;
      }
      await this.deps.db.newsItem.update({ where: { id: r.id }, data: { clusterId: best.row.id } });
      // A later, more serious report of the same story raises the story's rating.
      if (IMPACT_RANK[r.impact as NewsImpact] > IMPACT_RANK[best.row.impact as NewsImpact]) {
        best.row = await this.deps.db.newsItem.update({
          where: { id: best.row.id },
          data: { impact: r.impact, why: r.why, tags: [...new Set([...best.row.tags, ...r.tags])] },
        });
        if (!announce.some((a) => a.id === best.row.id)) announce.push(best.row);
      }
    }

    const out: NewsItemDto[] = [];
    for (const r of announce) {
      // Old items arriving late (first start, a source catching up) are stored, not announced.
      if (r.publishedAt.getTime() < now - 30 * MIN) continue;
      const item = toNewsDto(r);
      const msg: NewsLiveUpdate = { type: "headline", item };
      await this.deps.redis.publish(NEWS_LIVE_CHANNEL, JSON.stringify(msg));
      out.push(item);
    }
    return out;
  }

  async pollFinnhub(): Promise<number> {
    const key = this.deps.finnhubKey;
    if (!key) return 0;
    let n = 0;
    for (const section of FINNHUB_CATEGORIES) {
      try {
        const items = await fetchFinnhubNews(
          { ...this.opts, apiKey: key },
          section,
          this.minId.get(section),
        );
        const top = Math.max(0, ...items.map((i) => Number(i.sourceId)));
        if (top > (this.minId.get(section) ?? 0)) this.minId.set(section, top);
        n += (await this.ingest(items)).length;
      } catch (err) {
        log.warn("finnhub news unavailable", { section, err: (err as Error).message });
      }
    }
    return n;
  }

  async pollCentralBanks(): Promise<number> {
    let n = 0;
    for (const feed of CENTRAL_BANK_FEEDS) {
      try {
        n += (await this.ingest(await fetchCentralBankFeed(this.opts, feed))).length;
      } catch (err) {
        log.warn("central bank feed unavailable", { url: feed.url, err: (err as Error).message });
      }
    }
    return n;
  }

  async pollGdelt(): Promise<number> {
    try {
      return (await this.ingest(await fetchGdelt(this.opts, "30min"))).length;
    } catch (err) {
      log.warn("gdelt unavailable", { err: (err as Error).message });
      return 0;
    }
  }

  /**
   * Bitcoin and gold moves 15 and 60 minutes after each High story of the last 6 hours, once those
   * minutes have closed. Measured facts only: from the open of the publication minute.
   */
  async measureReactions(): Promise<number> {
    const now = this.now();
    const due = await this.deps.db.newsItem.findMany({
      where: {
        impact: "HIGH",
        clusterId: null,
        publishedAt: { gte: new Date(now - 6 * H), lte: new Date(now - 16 * MIN) },
      },
      take: 50,
    });
    let n = 0;
    for (const r of due) {
      const prev = (r.reaction as NewsReactionDto | null) ?? null;
      const pub = r.publishedAt.getTime();
      const full = now >= pub + 61 * MIN;
      if (prev && (prev.btc60m !== null || !full)) continue;
      try {
        const [btc, gold] = await Promise.all([
          fetchBinanceMinuteCandles(this.deps.binance ?? {}, "BTCUSDT", pub, 62),
          fetchBinanceMinuteCandles(this.deps.binance ?? {}, "XAUUSDT", pub, 62).catch(() => []),
        ]);
        const reaction: NewsReactionDto = {
          btc15m: priceReaction(btc, pub, 15 * MIN),
          btc60m: full ? priceReaction(btc, pub, 60 * MIN) : null,
          gold15m: priceReaction(gold, pub, 15 * MIN),
          gold60m: full ? priceReaction(gold, pub, 60 * MIN) : null,
        };
        await this.deps.db.newsItem.update({
          where: { id: r.id },
          data: { reaction: reaction as unknown as Prisma.InputJsonValue },
        });
        n++;
      } catch (err) {
        log.warn("news reaction unavailable", { err: (err as Error).message });
      }
    }
    return n;
  }

  async cleanup(): Promise<number> {
    const res = await this.deps.db.newsItem.deleteMany({
      where: { publishedAt: { lt: new Date(this.now() - NEWS_RETENTION_DAYS * 24 * H) } },
    });
    return res.count;
  }

  /** Takes or renews the lock; true while this worker is the collector. */
  async tickLeadership(): Promise<boolean> {
    if (this.stopped) return false;
    if (this.leader) {
      const renewed = await this.deps.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        1,
        LOCK_KEY,
        this.token,
        LOCK_TTL_MS,
      );
      this.leader = Number(renewed) === 1;
    } else {
      this.leader =
        (await this.deps.redis.set(LOCK_KEY, this.token, "PX", LOCK_TTL_MS, "NX")) === "OK";
      if (this.leader) log.info("headline collector started");
    }
    return this.leader;
  }

  start(): { stop: () => Promise<void> } {
    const every = (ms: number, fn: () => Promise<unknown>) => {
      let busy = false;
      const run = async () => {
        if (busy || this.stopped) return;
        busy = true;
        try {
          if (await this.tickLeadership()) await fn();
        } catch (err) {
          log.warn("headline job failed", { err: (err as Error).message });
        } finally {
          busy = false;
        }
      };
      void run();
      this.timers.push(setInterval(run, ms));
    };
    // Finnhub: 3 sections every 15 s = 12 calls a minute (the free plan allows 60).
    every(15_000, () => this.pollFinnhub());
    every(60_000, () => this.pollCentralBanks());
    // GDELT refreshes every 15 minutes and allows one call every 5 seconds.
    every(5 * MIN, () => this.pollGdelt());
    every(MIN, () => this.measureReactions());
    every(H, () => this.cleanup());
    return { stop: () => this.stop() };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    if (this.leader) {
      await this.deps.redis
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          LOCK_KEY,
          this.token,
        )
        .catch(() => undefined);
    }
  }
}
