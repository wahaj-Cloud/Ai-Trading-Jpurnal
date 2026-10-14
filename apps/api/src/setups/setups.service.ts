import { planLimits } from "@atc/coach";
import type { Prisma } from "@atc/db";
import { fetchBinanceRecentCandles, fetchBinanceUniverse } from "@atc/exchange-adapters";
import {
  SETUP_RULE_VERSION,
  SETUP_WINDOW,
  type SetupAlertDto,
  type SetupAlertsPage,
  type SetupAlertsQuery,
  type SetupDto,
  type SetupExchange,
  type SetupInput,
  type SetupPatch,
  type SetupPreviewDto,
  type SetupPreviewInput,
  type SetupsListDto,
  type SetupTimeframe,
  setupRuleSchema,
  UNLIMITED,
} from "@atc/shared";
import { evaluateSetupAt } from "@atc/ta";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";

type SetupRow = Prisma.SetupGetPayload<object>;
/** Candles shown in the preview (after the evaluation window). */
const PREVIEW_CANDLES = 500;
const UNIVERSE_TTL_MS = 60 * 60_000;

/** My Setup Alerts: the trader's own setups (data, never code) and their alert history. */
@Injectable()
export class SetupsService {
  private universe: { at: number; symbols: Set<string> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get binance() {
    return { futuresBaseUrl: this.env.BINANCE_FUTURES_BASE_URL };
  }

  /** Symbols that are trading right now (cached for an hour). */
  private async assertSymbols(symbols: readonly string[]): Promise<void> {
    if (!this.universe || Date.now() - this.universe.at > UNIVERSE_TTL_MS) {
      try {
        const list = await fetchBinanceUniverse(this.binance);
        this.universe = { at: Date.now(), symbols: new Set(list.map((s) => s.symbol)) };
      } catch {
        // Exchange unreachable: accept the symbols; the scanner skips any it cannot fetch.
        if (!this.universe) return;
      }
    }
    const unknown = symbols.filter((s) => !this.universe?.symbols.has(s));
    if (unknown.length)
      throw new BadRequestException(
        `Not a Binance USDT perpetual right now: ${unknown.join(", ")}`,
      );
  }

  private async dto(rows: SetupRow[]): Promise<SetupDto[]> {
    if (!rows.length) return [];
    const since = new Date(Date.now() - 30 * 86_400_000);
    const stats = await this.prisma.client.setupAlert.groupBy({
      by: ["setupId"],
      where: { setupId: { in: rows.map((r) => r.id) }, createdAt: { gte: since } },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    const last = await this.prisma.client.setupAlert.groupBy({
      by: ["setupId"],
      where: { setupId: { in: rows.map((r) => r.id) } },
      _max: { createdAt: true },
    });
    const count = new Map(stats.map((s) => [s.setupId, s._count._all]));
    const lastAt = new Map(last.map((s) => [s.setupId, s._max.createdAt]));
    return rows.flatMap((r) => {
      const rule = setupRuleSchema.safeParse(r.rule);
      if (!rule.success) return [];
      return [
        {
          id: r.id,
          name: r.name,
          exchange: r.exchange as SetupExchange,
          symbols: r.symbols,
          timeframe: r.timeframe as SetupTimeframe,
          rule: rule.data,
          cooldownMinutes: r.cooldownMinutes,
          isActive: r.isActive,
          createdAt: r.createdAt.toISOString(),
          lastAlertAt: lastAt.get(r.id)?.toISOString() ?? null,
          alerts30d: count.get(r.id) ?? 0,
        },
      ];
    });
  }

  async list(userId: string): Promise<SetupsListDto> {
    const [rows, limits] = await Promise.all([
      this.prisma.client.setup.findMany({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: "asc" },
      }),
      planLimits(this.prisma.client, userId),
    ]);
    return {
      items: await this.dto(rows),
      limit: limits.setups,
      emailAlerts: limits.setupAlertEmail === 1,
    };
  }

  private async owned(userId: string, id: string): Promise<SetupRow> {
    const row = await this.prisma.client.setup.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!row) throw new NotFoundException("Setup not found");
    return row;
  }

  async get(userId: string, id: string): Promise<SetupDto> {
    const [dto] = await this.dto([await this.owned(userId, id)]);
    if (!dto) throw new NotFoundException("Setup not found");
    return dto;
  }

  async create(userId: string, input: SetupInput): Promise<SetupDto> {
    await this.assertSymbols(input.symbols);
    const limits = await planLimits(this.prisma.client, userId);
    const row = await this.prisma.client.$transaction(async (tx) => {
      // Serialises this user's creates, so two at once can never pass the plan limit together.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`setups:${userId}`}))`;
      const count = await tx.setup.count({ where: { userId, deletedAt: null } });
      if (limits.setups !== UNLIMITED && count >= limits.setups)
        throw new ForbiddenException(
          limits.setups === 0
            ? "Setup alerts are not included in your plan."
            : `Your plan includes ${limits.setups} saved setup${limits.setups === 1 ? "" : "s"}. Upgrade or delete one to add another.`,
        );
      return tx.setup.create({
        data: {
          userId,
          name: input.name,
          exchange: input.exchange,
          symbols: input.symbols,
          timeframe: input.timeframe,
          rule: input.rule,
          ruleVersion: SETUP_RULE_VERSION,
          cooldownMinutes: input.cooldownMinutes,
        },
      });
    });
    return this.get(userId, row.id);
  }

  async update(userId: string, id: string, patch: SetupPatch): Promise<SetupDto> {
    await this.owned(userId, id);
    if (patch.symbols) await this.assertSymbols(patch.symbols);
    await this.prisma.client.setup.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.exchange !== undefined && { exchange: patch.exchange }),
        ...(patch.symbols !== undefined && { symbols: patch.symbols }),
        ...(patch.timeframe !== undefined && { timeframe: patch.timeframe }),
        ...(patch.rule !== undefined && { rule: patch.rule, ruleVersion: SETUP_RULE_VERSION }),
        ...(patch.cooldownMinutes !== undefined && { cooldownMinutes: patch.cooldownMinutes }),
      },
    });
    return this.get(userId, id);
  }

  async setActive(userId: string, id: string, isActive: boolean): Promise<SetupDto> {
    const row = await this.owned(userId, id);
    if (isActive && !row.isActive) {
      // Resuming counts against the plan too (a downgrade may have left extra setups paused).
      const limits = await planLimits(this.prisma.client, userId);
      const active = await this.prisma.client.setup.count({
        where: { userId, deletedAt: null, isActive: true },
      });
      if (limits.setups !== UNLIMITED && active >= limits.setups)
        throw new ConflictException("Pause another setup first, or upgrade for more.");
    }
    await this.prisma.client.setup.update({ where: { id }, data: { isActive } });
    return this.get(userId, id);
  }

  /** Soft delete: past alerts keep their history, and backtests keep their own copy of the rule. */
  async remove(userId: string, id: string): Promise<void> {
    await this.owned(userId, id);
    await this.prisma.client.setup.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /** Runs an unsaved rule over recent candles so the trader can tune it before saving. */
  async preview(input: SetupPreviewInput): Promise<SetupPreviewDto> {
    let candles: Awaited<ReturnType<typeof fetchBinanceRecentCandles>>;
    try {
      candles = await fetchBinanceRecentCandles(
        this.binance,
        input.symbol,
        input.timeframe,
        SETUP_WINDOW + PREVIEW_CANDLES,
      );
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 400) throw new BadRequestException(`Unknown symbol ${input.symbol}`);
      throw new ServiceUnavailableException("Market data is unavailable right now. Try again.");
    }
    const start = Math.max(0, candles.length - PREVIEW_CANDLES);
    const matches: SetupPreviewDto["matches"] = [];
    for (let i = start; i < candles.length; i++) {
      const m = evaluateSetupAt(input.rule, candles, i);
      if (m.matched) matches.push({ t: (candles[i] as { t: number }).t, matched: m.labels });
    }
    return {
      symbol: input.symbol,
      timeframe: input.timeframe,
      candles: candles.slice(start).map(({ t, o, h, l, c }) => ({ t, o, h, l, c })),
      matches,
    };
  }

  async alerts(userId: string, q: SetupAlertsQuery): Promise<SetupAlertsPage> {
    const rows = await this.prisma.client.setupAlert.findMany({
      where: {
        userId,
        ...(q.setupId ? { setupId: q.setupId } : {}),
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: q.limit + 1,
      include: {
        setup: { select: { name: true } },
        positions: { select: { id: true }, take: 1 },
      },
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map(
        (a): SetupAlertDto => ({
          id: a.id,
          setupId: a.setupId,
          setupName: a.setup.name,
          symbol: a.symbol,
          timeframe: a.timeframe as SetupTimeframe,
          direction: a.direction === "short" ? "short" : "long",
          candleCloseAt: a.candleCloseAt.toISOString(),
          matched: Array.isArray(a.matched) ? (a.matched as string[]) : [],
          positionId: a.positions[0]?.id ?? null,
          dismissed: a.dismissedAt !== null,
          createdAt: a.createdAt.toISOString(),
        }),
      ),
      nextCursor: rows.length > q.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async dismiss(userId: string, id: string): Promise<void> {
    const res = await this.prisma.client.setupAlert.updateMany({
      where: { id, userId, dismissedAt: null },
      data: { dismissedAt: new Date() },
    });
    if (res.count === 0) {
      const exists = await this.prisma.client.setupAlert.count({ where: { id, userId } });
      if (!exists) throw new NotFoundException("Alert not found");
    }
  }
}
