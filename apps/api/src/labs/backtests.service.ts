import { planLimits, releaseUsage, reserveUsage, usageCount } from "@atc/coach";
import type { Prisma } from "@atc/db";
import {
  BACKTEST_QUEUE,
  BACKTEST_USAGE_METRIC,
  type BacktestInput,
  type BacktestJobData,
  type BacktestRunDto,
  type BacktestRunsDto,
  type BacktestStatus,
  type BacktestSummary,
  type BacktestTradeChartDto,
  type BacktestTradesPage,
  type BacktestTradesQuery,
  exitModelSchema,
  type SetupTimeframe,
  setupRuleSchema,
  UNLIMITED,
} from "@atc/shared";
import { TIMEFRAME_MS } from "@atc/ta";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Queue } from "bullmq";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { safeText } from "../reports/render.js";

type RunRow = Prisma.BacktestRunGetPayload<object>;
const DAY_MS = 86_400_000;

function runDto(r: RunRow): BacktestRunDto {
  return {
    id: r.id,
    setupId: r.setupId,
    setupName: r.setupName,
    timeframe: r.timeframe as SetupTimeframe,
    symbols: r.symbols,
    from: r.fromDay.toISOString().slice(0, 10),
    to: r.toDay.toISOString().slice(0, 10),
    exit: exitModelSchema.parse(r.exitModel),
    status: r.status as BacktestStatus,
    progress: r.progress,
    summary: (r.summary as BacktestSummary | null) ?? null,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

/** Strategy Lab (Premium): queues backtests for the worker and serves their results. */
@Injectable()
export class BacktestsService implements OnModuleDestroy {
  private readonly logger = new Logger(BacktestsService.name);
  private readonly queue: Queue<BacktestJobData>;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) env: Env,
  ) {
    this.queue = new Queue<BacktestJobData>(BACKTEST_QUEUE, {
      connection: { url: env.REDIS_URL, maxRetriesPerRequest: null, family: 0 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }

  async list(userId: string, now = new Date()): Promise<BacktestRunsDto> {
    const [rows, limits] = await Promise.all([
      this.prisma.client.backtestRun.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      planLimits(this.prisma.client, userId),
    ]);
    return {
      items: rows.map(runDto),
      used: await usageCount(
        this.prisma.client,
        userId,
        BACKTEST_USAGE_METRIC,
        now.toISOString().slice(0, 7),
      ),
      limit: limits.backtestRunsPerMonth,
      historyMonths: limits.backtestHistoryMonths,
    };
  }

  async get(userId: string, id: string): Promise<BacktestRunDto> {
    const row = await this.prisma.client.backtestRun.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException("Backtest not found");
    return runDto(row);
  }

  async create(userId: string, input: BacktestInput, now = new Date()): Promise<BacktestRunDto> {
    const db = this.prisma.client;
    const limits = await planLimits(db, userId);
    if (limits.backtestRunsPerMonth === 0)
      throw new ForbiddenException(
        "Strategy Lab is part of the Premium plan. Upgrade to test your setups on past candles.",
      );
    const from = new Date(`${input.from}T00:00:00Z`);
    const to = new Date(`${input.to}T00:00:00Z`);
    if (to.getTime() > now.getTime())
      throw new BadRequestException("The end date cannot be in the future.");
    if (limits.backtestHistoryMonths !== UNLIMITED) {
      const earliest = new Date(now);
      earliest.setUTCMonth(earliest.getUTCMonth() - limits.backtestHistoryMonths);
      if (from < earliest)
        throw new BadRequestException(
          `Your plan tests up to ${limits.backtestHistoryMonths} months back (from ${earliest.toISOString().slice(0, 10)}).`,
        );
    }
    if (to.getTime() - from.getTime() < DAY_MS)
      throw new BadRequestException("Choose at least two days.");

    const setup = await db.setup.findFirst({
      where: { id: input.setupId, userId, deletedAt: null },
    });
    if (!setup) throw new NotFoundException("Setup not found");
    const rule = setupRuleSchema.safeParse(setup.rule);
    if (!rule.success) throw new BadRequestException("This setup needs to be saved again first.");

    const period = now.toISOString().slice(0, 7);
    const run = await db.$transaction(async (tx) => {
      // One run at a time per user keeps the shared worker fair.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`backtest:${userId}`}))`;
      const busy = await tx.backtestRun.count({
        where: { userId, status: { in: ["QUEUED", "RUNNING"] } },
      });
      if (busy > 0)
        throw new ConflictException("You already have a test running. Wait for it to finish.");
      if (
        limits.backtestRunsPerMonth !== UNLIMITED &&
        !(await reserveUsage(
          tx,
          userId,
          BACKTEST_USAGE_METRIC,
          period,
          limits.backtestRunsPerMonth,
        ))
      )
        throw new ForbiddenException(
          `You have used all ${limits.backtestRunsPerMonth} tests for this month.`,
        );
      return tx.backtestRun.create({
        data: {
          userId,
          setupId: setup.id,
          setupName: setup.name,
          rule: rule.data,
          exchange: setup.exchange,
          timeframe: setup.timeframe,
          symbols: input.symbols,
          exitModel: input.exit,
          fromDay: from,
          toDay: to,
        },
      });
    });
    try {
      await this.queue.add(
        "backtest",
        { runId: run.id },
        {
          jobId: `bt-${run.id}`,
          attempts: 2,
          backoff: { type: "fixed", delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    } catch (err) {
      this.logger.error({ msg: "could not queue backtest", runId: run.id, err });
      await db.backtestRun.update({
        where: { id: run.id },
        data: { status: "FAILED", error: "Could not start the test. Try again.", finishedAt: now },
      });
      await releaseUsage(db, userId, BACKTEST_USAGE_METRIC, period);
    }
    return this.get(userId, run.id);
  }

  async trades(userId: string, id: string, q: BacktestTradesQuery): Promise<BacktestTradesPage> {
    await this.get(userId, id);
    const rows = await this.prisma.client.backtestTrade.findMany({
      where: { runId: id, ...(q.cursor ? { id: { gt: q.cursor } } : {}) },
      orderBy: { id: "asc" },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((t) => ({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        entryAt: t.entryAt.toISOString(),
        entryPrice: t.entryPrice,
        exitAt: t.exitAt.toISOString(),
        exitPrice: t.exitPrice,
        exitReason: t.exitReason as BacktestTradesPage["items"][number]["exitReason"],
        rMultiple: t.rMultiple,
        pnl: t.pnl,
        fees: t.fees,
        funding: t.funding,
        flags: t.flags,
      })),
      nextCursor: rows.length > q.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** Candles around one simulated trade (from the shared store), for the trade chart. */
  async tradeChart(userId: string, id: string, tradeId: string): Promise<BacktestTradeChartDto> {
    const run = await this.get(userId, id);
    const trade = await this.prisma.client.backtestTrade.findFirst({
      where: { id: tradeId, runId: id },
    });
    if (!trade) throw new NotFoundException("Trade not found");
    const step = TIMEFRAME_MS[run.timeframe];
    const rows = await this.prisma.client.marketCandle.findMany({
      where: {
        exchange: "BINANCE",
        symbol: trade.symbol,
        timeframe: run.timeframe,
        openTime: {
          gte: new Date(trade.entryAt.getTime() - 80 * step),
          lte: new Date(trade.exitAt.getTime() + 30 * step),
        },
      },
      orderBy: { openTime: "asc" },
      take: 600,
    });
    return {
      symbol: trade.symbol,
      timeframe: run.timeframe,
      candles: rows.map((r) => ({
        t: r.openTime.getTime(),
        o: r.open,
        h: r.high,
        l: r.low,
        c: r.close,
      })),
      entryAt: trade.entryAt.getTime(),
      exitAt: trade.exitAt.getTime(),
      side: trade.side,
      win: trade.pnl > 0,
    };
  }

  async csv(userId: string, id: string): Promise<{ filename: string; body: string }> {
    const run = await this.get(userId, id);
    const rows = await this.prisma.client.backtestTrade.findMany({
      where: { runId: id },
      orderBy: { entryAt: "asc" },
    });
    const cell = (v: string | number) => {
      if (typeof v === "number") return String(v);
      const t = safeText(v);
      return /[",\n\r]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
    };
    const lines = [
      "Symbol,Side,Entry time (UTC),Entry price,Exit time (UTC),Exit price,Exit reason,R multiple,P&L,Fees,Funding,Flags",
      ...rows.map((t) =>
        [
          cell(t.symbol),
          cell(t.side),
          cell(t.entryAt.toISOString()),
          t.entryPrice,
          cell(t.exitAt.toISOString()),
          t.exitPrice,
          cell(t.exitReason),
          t.rMultiple,
          t.pnl,
          t.fees,
          t.funding,
          cell(t.flags.join(" ")),
        ].join(","),
      ),
    ];
    const safeName = run.setupName.replace(/[^\w-]+/g, "-").slice(0, 40) || "setup";
    return {
      filename: `backtest-${safeName}-${run.from}-${run.to}.csv`,
      body: `﻿${lines.join("\r\n")}\r\n`,
    };
  }

  async remove(userId: string, id: string): Promise<void> {
    const run = await this.prisma.client.backtestRun.findFirst({ where: { id, userId } });
    if (!run) throw new NotFoundException("Backtest not found");
    if (run.status === "QUEUED") {
      await this.queue.remove(`bt-${id}`).catch(() => undefined);
    } else if (run.status === "RUNNING") {
      throw new ConflictException("This test is running. Delete it when it has finished.");
    }
    await this.prisma.client.backtestRun.delete({ where: { id } });
  }
}
