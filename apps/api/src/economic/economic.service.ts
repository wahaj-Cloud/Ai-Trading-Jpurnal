import type { EconomicCalendarDto, EconomicCalendarQuery, Impact } from "@atc/shared";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { type ParsedEvent, parseForexFactory } from "./economic.parse.js";

const SOURCE = "forexfactory";
/** The source publishes hourly and allows only a couple of downloads every few minutes. */
const REFRESH_AFTER_MS = 60 * 60 * 1000;
/** After a failed download, wait before trying again (never hammer the source). */
const RETRY_AFTER_MS = 10 * 60 * 1000;

/**
 * Economic calendar backed by our own table. The current (and, when published, next) week is
 * re-read from the source at most hourly by whichever request first finds it stale; past weeks
 * stay stored, so history grows over time.
 */
@Injectable()
export class EconomicService {
  private readonly logger = new Logger(EconomicService.name);
  private refreshing: Promise<void> | null = null;
  private lastAttempt = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(q: EconomicCalendarQuery): Promise<EconomicCalendarDto> {
    await this.maybeRefresh();
    const rows = await this.prisma.client.economicEvent.findMany({
      where: {
        startsAt: { gte: new Date(q.from), lt: new Date(q.to) },
        ...(q.impact.length > 0 && { impact: { in: q.impact } }),
        ...(q.currency.length > 0 && { currency: { in: q.currency } }),
      },
      orderBy: [{ startsAt: "asc" }, { title: "asc" }],
      take: 2000,
    });
    const latest = await this.prisma.client.economicEvent.aggregate({ _max: { fetchedAt: true } });
    return {
      events: rows.map((r) => ({
        id: r.id,
        title: r.title,
        currency: r.currency,
        impact: r.impact as Impact,
        startsAt: r.startsAt.toISOString(),
        tentative: r.tentative,
        actual: r.actual,
        forecast: r.forecast,
        previous: r.previous,
      })),
      fetchedAt: latest._max.fetchedAt?.toISOString() ?? null,
      source: { name: "Forex Factory", url: "https://www.forexfactory.com/calendar" },
    };
  }

  private async maybeRefresh(): Promise<void> {
    if (this.env.NODE_ENV === "test") return;
    if (Date.now() - this.lastAttempt < RETRY_AFTER_MS) return;
    const latest = await this.prisma.client.economicEvent.aggregate({ _max: { fetchedAt: true } });
    const last = latest._max.fetchedAt?.getTime() ?? 0;
    if (Date.now() - last < REFRESH_AFTER_MS) return;
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    try {
      await this.refreshing;
    } catch (err) {
      // Serve what is stored; the calendar just shows slightly older data.
      this.logger.warn(`Economic calendar refresh failed: ${(err as Error).message}`);
    }
  }

  private async refresh(): Promise<void> {
    this.lastAttempt = Date.now();
    const thisWeek = await this.download(this.env.ECON_CALENDAR_URL);
    await this.store(thisWeek);
    // Next week is published late in the week; its absence is normal.
    if (this.env.ECON_CALENDAR_NEXT_URL) {
      try {
        await this.store(await this.download(this.env.ECON_CALENDAR_NEXT_URL));
      } catch {
        // not published yet
      }
    }
    this.logger.log(`Economic calendar refreshed: ${thisWeek.length} events this week`);
  }

  private async download(url: string): Promise<ParsedEvent[]> {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        accept: "application/json",
        "user-agent": "WickMentor/1.0 (+https://wickmentor.com)",
      },
    });
    if (!res.ok) throw new Error(`Source answered ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("json")) throw new Error(`Source sent ${type || "no content type"}`);
    return parseForexFactory(await res.json(), SOURCE);
  }

  /**
   * Replaces the downloaded window: events in it that the source no longer lists (rescheduled or
   * removed) are deleted, the rest upserted. Rows outside the window are untouched.
   */
  private async store(events: ParsedEvent[]): Promise<void> {
    const times = events.map((e) => e.startsAt.getTime());
    const from = new Date(Math.min(...times));
    const to = new Date(Math.max(...times));
    const fetchedAt = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      await tx.economicEvent.deleteMany({
        where: {
          source: SOURCE,
          startsAt: { gte: from, lte: to },
          id: { notIn: events.map((e) => e.id) },
        },
      });
      for (const e of events) {
        const data = {
          title: e.title,
          currency: e.currency,
          impact: e.impact,
          startsAt: e.startsAt,
          tentative: e.tentative,
          actual: e.actual,
          forecast: e.forecast,
          previous: e.previous,
          source: SOURCE,
          fetchedAt,
        };
        await tx.economicEvent.upsert({
          where: { id: e.id },
          create: { id: e.id, ...data },
          update: data,
        });
      }
    });
  }
}
