import { planLimits, settlePaperTrade } from "@atc/coach";
import type { PrismaClient } from "@atc/db";
import { snapshotsOf } from "@atc/db";
import {
  type CreatePaperBot,
  createPaperBotSchema,
  isPinned,
  PAPER_EXIT_LABEL,
  PAPER_SESSION_LABEL,
  type PaperBotDetailDto,
  type PaperBotDto,
  type PaperBotsPage,
  type PaperEntryNote,
  type PaperExitReason,
  type PaperSide,
  type PaperSource,
  type PaperTradeDto,
  paperBreakdown,
  paperMaturity,
  paperSessionOf,
  paperStats,
  SCALP_KEY,
  type ScalpSnapshot,
  SETUP_EXCHANGES,
  setupRuleSchema,
  UNLIMITED,
  type UpdatePaperBot,
  USD_SETTLEMENT_ASSETS,
  updatePaperBotSchema,
} from "@atc/shared";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../auth/decorators.js";
import type { AuthenticatedUser } from "../common/request.types.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LiveFlowService } from "./live-flow.service.js";

type BotRow = Awaited<ReturnType<PrismaClient["paperBot"]["findMany"]>>[number];
type TradeRow = Awaited<ReturnType<PrismaClient["paperTrade"]["findMany"]>>[number];

const tradeDto = (t: TradeRow): PaperTradeDto => ({
  id: t.id,
  symbol: t.symbol,
  side: t.side as PaperSide,
  entryAt: t.entryAt.toISOString(),
  entryPrice: t.entryPrice,
  stop: t.stop,
  target: t.target,
  qty: t.qty,
  riskUsd: t.riskUsd,
  entryNote: (t.entryNote as PaperEntryNote | null) ?? null,
  exitAt: t.exitAt?.toISOString() ?? null,
  exitPrice: t.exitPrice,
  exitReason: (t.exitReason as PaperExitReason | null) ?? null,
  fees: t.fees,
  funding: t.funding,
  pnl: t.pnl,
  rMultiple: t.rMultiple,
  status: t.status === "OPEN" ? "OPEN" : "CLOSED",
});

/**
 * Paper bots: the trader's rules run with virtual money on live prices (see the worker's paper
 * engine). This keeps the list and the results; nothing here can reach an exchange account.
 */
@Injectable()
export class PaperBotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveFlowService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  private dto(
    b: BotRow,
    closed: TradeRow[],
    open: TradeRow | null,
    setupName: string | null,
    now: number,
  ): PaperBotDto {
    const stats = paperStats(closed, b.startEquity);
    return {
      id: b.id,
      name: b.name,
      symbol: b.symbol,
      source: b.source as PaperSource,
      tf: b.tf,
      setupId: b.setupId,
      setupName,
      direction: b.direction as PaperBotDto["direction"],
      minCount: b.minCount,
      noNews: b.noNews,
      stopRanges: b.stopRanges,
      targetR: b.targetR,
      maxHoldMin: b.maxHoldMin,
      riskPct: b.riskPct,
      feeBps: b.feeBps,
      slippageBps: b.slippageBps,
      startEquity: b.startEquity,
      equity: b.equity,
      enabled: b.enabled,
      startedAt: b.startedAt.toISOString(),
      createdAt: b.createdAt.toISOString(),
      stats,
      open: open ? tradeDto(open) : null,
      maturity: paperMaturity(b.startedAt.getTime(), now, stats.trades),
    };
  }

  async list(userId: string): Promise<PaperBotsPage> {
    const [bots, limits] = await Promise.all([
      this.db.paperBot.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        include: { setup: { select: { name: true } } },
      }),
      planLimits(this.db, userId),
    ]);
    const trades = bots.length
      ? await this.db.paperTrade.findMany({
          where: { botId: { in: bots.map((b) => b.id) } },
          orderBy: [{ exitAt: "asc" }, { entryAt: "asc" }],
        })
      : [];
    const now = Date.now();
    const [snap, setups, tick] = await Promise.all([
      snapshotsOf(this.db).get(SCALP_KEY),
      this.db.setup.findMany({
        where: { userId, deletedAt: null, exchange: { in: [...SETUP_EXCHANGES] } },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, timeframe: true, symbols: true },
      }),
      this.live.latestTick().catch(() => null),
    ]);
    const coins = (snap?.data as ScalpSnapshot | undefined)?.coins ?? [];
    const markets = coins
      .filter(
        (c) =>
          limits.marketPulseCoins === UNLIMITED ||
          c.rank <= limits.marketPulseCoins ||
          isPinned(c.symbol),
      )
      .sort((a, b) => a.rank - b.rank)
      .map((c) => c.symbol);
    return {
      markets,
      setups,
      live: tick !== null && now - tick.at < 15_000,
      items: bots.map((b) => {
        const mine = trades.filter((t) => t.botId === b.id);
        return this.dto(
          b,
          mine.filter((t) => t.status === "CLOSED"),
          mine.find((t) => t.status === "OPEN") ?? null,
          b.setup?.name ?? null,
          now,
        );
      }),
      limit: limits.paperBots,
    };
  }

  private async owned(userId: string, id: string) {
    const bot = await this.db.paperBot.findFirst({
      where: { id, userId },
      include: { setup: { select: { name: true } } },
    });
    if (!bot) throw new NotFoundException("Paper bot not found");
    return bot;
  }

  async get(userId: string, id: string): Promise<PaperBotDetailDto> {
    const bot = await this.owned(userId, id);
    const trades = await this.db.paperTrade.findMany({
      where: { botId: id },
      orderBy: [{ exitAt: "asc" }, { entryAt: "asc" }],
    });
    const closed = trades.filter((t) => t.status === "CLOSED");
    const open = trades.find((t) => t.status === "OPEN") ?? null;
    const base = this.dto(bot, closed, open, bot.setup?.name ?? null, Date.now());
    const dtos = closed.map(tradeDto);
    let eq = bot.startEquity;
    const curve = [{ at: bot.startedAt.toISOString(), equity: eq }];
    for (const t of closed) {
      eq += t.pnl ?? 0;
      curve.push({ at: (t.exitAt ?? t.entryAt).toISOString(), equity: eq });
    }
    // The trader's own closed trades on the same market since the run started.
    const coin = bot.symbol.replace(/USDT$/, "");
    const real = await this.db.position.findMany({
      where: {
        userId,
        status: "CLOSED",
        baseAsset: { in: [coin, `1000${coin}`], mode: "insensitive" },
        settleAsset: { in: [...USD_SETTLEMENT_ASSETS] },
        openedAt: { gte: bot.startedAt },
        netPnl: { not: null },
      },
      select: { netPnl: true },
    });
    const realWins = real.filter((r) => Number(r.netPnl) > 0).length;
    return {
      ...base,
      // Newest first for the table; the chart uses `curve`.
      trades: [...(open ? [tradeDto(open)] : []), ...dtos.slice().reverse()].slice(0, 500),
      curve,
      bySession: paperBreakdown(
        dtos,
        (t) => paperSessionOf(Date.parse(t.entryAt)),
        PAPER_SESSION_LABEL,
      ),
      bySide: paperBreakdown(dtos, (t) => t.side, { LONG: "Long", SHORT: "Short" }),
      byExit: paperBreakdown(dtos, (t) => t.exitReason ?? "MANUAL", PAPER_EXIT_LABEL),
      real: real.length
        ? {
            trades: real.length,
            winRatePct: (realWins / real.length) * 100,
            netPnl: real.reduce((s, r) => s + Number(r.netPnl), 0),
          }
        : null,
    };
  }

  async create(userId: string, input: CreatePaperBot): Promise<PaperBotDto> {
    const [limits, count] = await Promise.all([
      planLimits(this.db, userId),
      this.db.paperBot.count({ where: { userId } }),
    ]);
    if (limits.paperBots !== UNLIMITED && count >= limits.paperBots)
      throw new ForbiddenException(
        `Your plan keeps ${limits.paperBots} paper bot${limits.paperBots === 1 ? "" : "s"}. Delete one or upgrade for more.`,
      );
    let data: Parameters<PrismaClient["paperBot"]["create"]>[0]["data"];
    let setupName: string | null = null;
    if (input.source === "COCKPIT") {
      const snap = await snapshotsOf(this.db).get(SCALP_KEY);
      const coin = (snap?.data as ScalpSnapshot | undefined)?.coins?.find(
        (c) => c.symbol === input.symbol,
      );
      if (!coin) throw new BadRequestException("This market is not in the scan right now.");
      if (
        limits.marketPulseCoins !== UNLIMITED &&
        coin.rank > limits.marketPulseCoins &&
        !isPinned(coin.symbol)
      )
        throw new ForbiddenException("Your plan covers the top 20 coins, gold and silver.");
      // It enters when its rule starts holding after creation, never part-way through a move.
      const { source, ...rest } = input;
      data = { ...rest, userId, source, equity: input.startEquity, lastMet: true };
    } else {
      const setup = await this.db.setup.findFirst({
        where: { id: input.setupId, userId, deletedAt: null },
      });
      if (!setup) throw new NotFoundException("Setup not found");
      if (!(SETUP_EXCHANGES as readonly string[]).includes(setup.exchange))
        throw new BadRequestException("Paper bots run on Binance setups.");
      if (!setupRuleSchema.safeParse(setup.rule).success)
        throw new BadRequestException("This setup needs saving again before a bot can use it.");
      if (!setup.symbols.includes(input.symbol))
        throw new BadRequestException("Pick one of the setup's markets.");
      setupName = setup.name;
      const { source, ...rest } = input;
      data = {
        ...rest,
        userId,
        source,
        tf: setup.timeframe,
        equity: input.startEquity,
      };
    }
    const bot = await this.db.paperBot.create({ data });
    return this.dto(bot, [], null, setupName, Date.now());
  }

  async update(userId: string, id: string, patch: UpdatePaperBot): Promise<PaperBotDto> {
    await this.owned(userId, id);
    await this.db.paperBot.update({
      where: { id },
      // A resumed bot waits for its rule to start holding again.
      data: { ...patch, ...(patch.enabled !== undefined ? { lastMet: true } : {}) },
    });
    return (await this.list(userId)).items.find((b) => b.id === id) as PaperBotDto;
  }

  async remove(userId: string, id: string): Promise<void> {
    const res = await this.db.paperBot.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw new NotFoundException("Paper bot not found");
  }

  /** Starts the run again: every trade is cleared and the equity goes back to the start. */
  async reset(userId: string, id: string): Promise<PaperBotDto> {
    const bot = await this.owned(userId, id);
    await this.db.$transaction([
      this.db.paperTrade.deleteMany({ where: { botId: id } }),
      this.db.paperBot.update({
        where: { id },
        data: { equity: bot.startEquity, startedAt: new Date(), lastMet: true },
      }),
    ]);
    return (await this.list(userId)).items.find((b) => b.id === id) as PaperBotDto;
  }

  /** Closes the open trade now, at the live price less slippage, like a market order would. */
  async close(userId: string, id: string): Promise<PaperBotDto> {
    const bot = await this.owned(userId, id);
    const open = await this.db.paperTrade.findFirst({ where: { botId: id, status: "OPEN" } });
    if (!open) throw new ConflictException("This bot has no open trade.");
    const tick = await this.live.latestTick();
    const price = tick?.coins.find((c) => c.s === open.symbol)?.p;
    if (!tick || !price || !(price > 0) || Date.now() - tick.at > 15_000)
      throw new ConflictException("The live price is not available right now. Try again shortly.");
    const s = open.side === "LONG" ? 1 : -1;
    const done = await settlePaperTrade(
      this.db,
      { ...open, side: open.side as PaperSide },
      bot.feeBps,
      {
        exitPrice: price * (1 - (s * bot.slippageBps) / 10_000),
        reason: "MANUAL",
        at: Date.now(),
      },
    );
    if (!done) throw new ConflictException("The trade had just closed.");
    return (await this.list(userId)).items.find((b) => b.id === id) as PaperBotDto;
  }
}

@Controller({ path: "paper-bots", version: "1" })
export class PaperBotsController {
  constructor(private readonly bots: PaperBotsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<PaperBotsPage> {
    return this.bots.list(user.id);
  }

  @Get(":id")
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<PaperBotDetailDto> {
    return this.bots.get(user.id, id);
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createPaperBotSchema)) input: CreatePaperBot,
  ): Promise<PaperBotDto> {
    return this.bots.create(user.id, input);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePaperBotSchema)) patch: UpdatePaperBot,
  ): Promise<PaperBotDto> {
    return this.bots.update(user.id, id, patch);
  }

  @Post(":id/reset")
  @HttpCode(200)
  reset(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<PaperBotDto> {
    return this.bots.reset(user.id, id);
  }

  @Post(":id/close")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<PaperBotDto> {
    return this.bots.close(user.id, id);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.bots.remove(user.id, id);
  }
}
