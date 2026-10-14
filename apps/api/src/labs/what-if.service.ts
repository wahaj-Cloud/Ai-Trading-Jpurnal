import { isValidTimeZone, localParts, runWhatIf } from "@atc/analytics";
import { historyCutoff, planLimits } from "@atc/coach";
import {
  type WhatIfFilters,
  type WhatIfResultDto,
  type WhatIfScenarioDto,
  type WhatIfScenarioInput,
  type WhatIfTeaserDto,
  whatIfFiltersSchema,
} from "@atc/shared";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AnalyticsService } from "../analytics/analytics.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

const RANGE_DAYS: Record<WhatIfFilters["range"], number | null> = {
  "30d": 30,
  "90d": 90,
  "365d": 365,
  all: null,
};
const MAX_SCENARIOS = 20;
/** Fewer trades than this and the free preview says nothing (too little to compare). */
const TEASER_MIN_TRADES = 10;

/**
 * What-If Lab: the trader's real trades replayed under their own discipline rules. Computed on
 * request from the trades table (fast: imports are capped at 25,000 trades).
 */
@Injectable()
export class WhatIfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  private async assertAllowed(userId: string): Promise<void> {
    const limits = await planLimits(this.prisma.client, userId);
    if (limits.whatIf !== 1)
      throw new ForbiddenException(
        "What-If Lab is part of the Pro plan. Upgrade to replay your trades with your own rules.",
      );
  }

  private async compute(userId: string, filters: WhatIfFilters, now: Date) {
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const timeZone = isValidTimeZone(user.timezone) ? user.timezone : "UTC";
    const days = RANGE_DAYS[filters.range];
    let from = days === null ? null : new Date(now.getTime() - days * 86_400_000);
    // The plan's history window bounds the lab like every other report.
    const cutoff = await historyCutoff(this.prisma.client, userId, now);
    if (cutoff && (!from || from < cutoff)) from = cutoff;
    const trades = await this.analytics.loadTrades(userId, { from, to: null });
    return runWhatIf(trades, filters, {
      timeZone,
      now,
      range: {
        from: from ? localParts(from, timeZone).date : null,
        to: localParts(now, timeZone).date,
        timezone: timeZone,
      },
    });
  }

  async run(userId: string, filters: WhatIfFilters, now = new Date()): Promise<WhatIfResultDto> {
    await this.assertAllowed(userId);
    return this.compute(userId, filters, now);
  }

  /** One fixed scenario for every plan: shows Free traders what the lab would tell them. */
  async teaser(userId: string, now = new Date()): Promise<WhatIfTeaserDto> {
    const filters = whatIfFiltersSchema.parse({ range: "90d", stopAfterLosses: 2 });
    const r = await this.compute(userId, filters, now);
    const enough = r.actual.trades >= TEASER_MIN_TRADES;
    return {
      label: r.label,
      trades: r.actual.trades,
      difference: enough ? r.difference.netPnl : null,
      drawdownBefore: enough ? r.actual.maxDrawdown : null,
      drawdownAfter: enough ? r.scenario.maxDrawdown : null,
    };
  }

  async scenarios(userId: string): Promise<WhatIfScenarioDto[]> {
    const rows = await this.prisma.client.whatIfScenario.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    return rows.flatMap((r) => {
      const filters = whatIfFiltersSchema.safeParse(r.filters);
      return filters.success
        ? [{ id: r.id, name: r.name, filters: filters.data, createdAt: r.createdAt.toISOString() }]
        : [];
    });
  }

  async saveScenario(userId: string, input: WhatIfScenarioInput): Promise<WhatIfScenarioDto> {
    await this.assertAllowed(userId);
    const filters = whatIfFiltersSchema.parse(input.filters);
    const row = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`whatif:${userId}`}))`;
      const count = await tx.whatIfScenario.count({ where: { userId } });
      if (count >= MAX_SCENARIOS)
        throw new ConflictException(`You can save up to ${MAX_SCENARIOS} scenarios.`);
      return tx.whatIfScenario.create({ data: { userId, name: input.name, filters } });
    });
    return { id: row.id, name: row.name, filters, createdAt: row.createdAt.toISOString() };
  }

  async deleteScenario(userId: string, id: string): Promise<void> {
    const res = await this.prisma.client.whatIfScenario.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw new NotFoundException("Scenario not found");
  }
}
