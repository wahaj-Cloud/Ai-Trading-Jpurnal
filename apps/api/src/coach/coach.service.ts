import {
  AiRequestError,
  AiUnavailableError,
  answerHelp,
  behaviourForPeriod,
  type CoachDeps,
  CoachLimitError,
  type CoachModel,
  CoachNotFoundError,
  chat,
  coachStatus,
  evaluateTrade,
  getConversation,
  historyCutoff,
  markReviewPending,
  noteDto,
  planLimits,
  psychologyForPeriod,
  reserveUsage,
  reviewDto,
  storedContext,
  strategyInsights,
  writeNote,
} from "@atc/coach";
import type {
  BehaviourCode,
  BehaviourSummaryDto,
  ChatInput,
  CoachNoteDto,
  CoachStatusDto,
  ConversationDto,
  ConversationSummaryDto,
  Grade,
  HelpAnswerDto,
  HelpAskInput,
  PsychologyReportDto,
  ReviewedTradeDto,
  StrategyInsightDto,
  TradeContextDto,
  TradeReviewDto,
} from "@atc/shared";
import {
  BadGatewayException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { assertWithinHistory } from "../positions/positions.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AiQueueService } from "./ai-queue.service.js";
import { COACH_MODEL } from "./coach-model.js";

/** Maps coach errors to HTTP errors with messages the web app shows as-is. */
export function toHttp(err: unknown): never {
  if (err instanceof CoachLimitError) throw new ForbiddenException(err.message);
  if (err instanceof AiUnavailableError)
    throw new ServiceUnavailableException("AI coaching is not available right now.");
  if (err instanceof CoachNotFoundError) throw new NotFoundException(err.message);
  if (err instanceof AiRequestError)
    throw new BadGatewayException("The AI coach is busy. Try again in a minute.");
  throw err;
}

@Injectable()
export class CoachService {
  private readonly deps: CoachDeps;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(COACH_MODEL) private readonly model: CoachModel,
    private readonly queue: AiQueueService,
  ) {
    this.deps = { db: prisma.client, model };
  }

  /** Help-assistant answer; an AI outage falls back to the help page instead of an error. */
  async help(userId: string, input: HelpAskInput): Promise<HelpAnswerDto> {
    try {
      return await answerHelp(this.deps, userId, input);
    } catch (err) {
      if (err instanceof AiRequestError || err instanceof AiUnavailableError) {
        return {
          answer: "I can't answer right now. Please try again in a minute, or open the Help page.",
          links: [{ label: "Help", href: "/help" }],
        };
      }
      throw err;
    }
  }

  status(userId: string): Promise<CoachStatusDto> {
    return coachStatus(this.deps, userId);
  }

  /** Look-back windows are capped by the plan's history (Free: 30 days). */
  private async allowedDays(userId: string, days: number): Promise<number> {
    const { historyDays } = await planLimits(this.prisma.client, userId);
    return historyDays === -1 ? days : Math.max(1, Math.min(days, historyDays));
  }

  async behaviour(userId: string, days: number): Promise<BehaviourSummaryDto> {
    return behaviourForPeriod(this.prisma.client, userId, await this.allowedDays(userId, days));
  }

  async psychology(userId: string, days: number): Promise<PsychologyReportDto> {
    return psychologyForPeriod(this.prisma.client, userId, await this.allowedDays(userId, days));
  }

  /** Rules-based grade plus any stored AI review; null for trades that are not closed. */
  async tradeReview(userId: string, positionId: string): Promise<TradeReviewDto | null> {
    const evaluation = await evaluateTrade(this.prisma.client, userId, positionId);
    if (!evaluation) return null;
    const row = await this.prisma.client.tradeReview.findUnique({
      where: { userId_positionKey: { userId, positionKey: evaluation.trade.sourceKey } },
    });
    return reviewDto(evaluation, row, this.model.enabled);
  }

  /** Queues an AI review (or a refresh). The page polls until it is written. */
  async requestReview(userId: string, positionId: string, force: boolean): Promise<TradeReviewDto> {
    const evaluation = await evaluateTrade(this.prisma.client, userId, positionId);
    if (!evaluation) throw new NotFoundException("Only closed trades can be reviewed");
    await assertWithinHistory(this.prisma.client, userId, evaluation.trade.closedAt);
    if (!this.model.enabled) toHttp(new AiUnavailableError());
    await markReviewPending(this.prisma.client, evaluation, userId);
    const queued = await this.queue.enqueue(
      { kind: "REVIEW_TRADE", userId, positionId, force },
      force,
    );
    if (!queued)
      throw new ServiceUnavailableException("Could not start the review. Try again shortly.");
    const row = await this.prisma.client.tradeReview.findUnique({
      where: { userId_positionKey: { userId, positionKey: evaluation.trade.sourceKey } },
    });
    return reviewDto(evaluation, row, true);
  }

  /** Latest reviewed trades, for the journal history. Reviews whose trade no longer exists are skipped. */
  async recentReviews(userId: string, limit: number): Promise<ReviewedTradeDto[]> {
    const reviews = await this.prisma.client.tradeReview.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    const positions = await this.prisma.client.position.findMany({
      where: { userId, sourceKey: { in: reviews.map((r) => r.positionKey) } },
      select: {
        id: true,
        sourceKey: true,
        symbol: true,
        direction: true,
        closedAt: true,
        netPnl: true,
        settleAsset: true,
      },
    });
    const byKey = new Map(positions.map((p) => [p.sourceKey, p]));
    return reviews.flatMap((r) => {
      const p = byKey.get(r.positionKey);
      if (!p?.closedAt) return [];
      return [
        {
          positionId: p.id,
          symbol: p.symbol,
          direction: p.direction,
          closedAt: p.closedAt.toISOString(),
          netPnl: p.netPnl?.toString() ?? "0",
          settleAsset: p.settleAsset,
          grade: r.grade as Grade,
          score: r.score,
          summary: r.status === "DONE" ? r.summary : null,
          flags: (r.flags as unknown as { code: BehaviourCode }[]).map((f) => f.code),
          updatedAt: r.updatedAt.toISOString(),
        },
      ];
    });
  }

  /** Stored market context of a trade (computed by the worker). */
  async tradeContext(
    userId: string,
    positionId: string,
  ): Promise<{ context: TradeContextDto | null; status: "DONE" | "UNAVAILABLE" | "NONE" }> {
    const p = await this.prisma.client.position.findFirst({
      where: { id: positionId, userId },
      select: { sourceKey: true },
    });
    const row = p
      ? await this.prisma.client.tradeContext.findUnique({
          where: { userId_positionKey: { userId, positionKey: p.sourceKey } },
        })
      : null;
    return { context: storedContext(row), status: row?.status ?? "NONE" };
  }

  /** Queues market analysis of one closed trade. */
  async requestContext(userId: string, positionId: string): Promise<void> {
    const p = await this.prisma.client.position.findFirst({
      where: { id: positionId, userId, status: "CLOSED" },
      select: { id: true, closedAt: true },
    });
    if (!p) throw new NotFoundException("Only closed trades can be analysed");
    await assertWithinHistory(this.prisma.client, userId, p.closedAt);
    // Each analysis downloads market data from the exchange, shared by all users: cap per day.
    const day = new Date().toISOString().slice(0, 10);
    if (!(await reserveUsage(this.prisma.client, userId, "market_context_request", day, 100))) {
      throw new ForbiddenException("You can analyse 100 trades a day. Try again tomorrow.");
    }
    const queued = await this.queue.enqueue(
      { kind: "MARKET_CONTEXT", userId, positionId, force: true },
      true,
    );
    if (!queued)
      throw new ServiceUnavailableException("Could not start the analysis. Try again shortly.");
  }

  async strategy(userId: string, days: number): Promise<StrategyInsightDto[]> {
    const allowed = await this.allowedDays(userId, days);
    return strategyInsights(
      this.prisma.client,
      userId,
      new Date(Date.now() - allowed * 86_400_000),
    );
  }

  async notes(userId: string, limit: number): Promise<CoachNoteDto[]> {
    const rows = await this.prisma.client.coachNote.findMany({
      where: { userId },
      orderBy: [{ period: "desc" }, { kind: "asc" }],
      take: limit,
    });
    return rows.map(noteDto);
  }

  /** "Coach me on this day" on demand: written now (a few seconds), replacing any earlier note. */
  async dailyNote(userId: string, date: string): Promise<CoachNoteDto | null> {
    const cutoff = await historyCutoff(this.prisma.client, userId);
    if (cutoff && new Date(`${date}T23:59:59Z`) < cutoff) {
      throw new ForbiddenException("This day is older than your plan's history window.");
    }
    return writeNote(this.deps, userId, "DAILY", date, { force: true, onDemand: true }).catch(
      toHttp,
    );
  }

  async conversations(userId: string): Promise<ConversationSummaryDto[]> {
    const rows = await this.prisma.client.coachConversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, title: true, updatedAt: true },
    });
    return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
  }

  conversation(userId: string, id: string): Promise<ConversationDto> {
    return getConversation(this.prisma.client, userId, id).catch(toHttp);
  }

  async deleteConversation(userId: string, id: string): Promise<void> {
    const res = await this.prisma.client.coachConversation.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw new NotFoundException("Conversation not found");
  }

  chat(userId: string, input: ChatInput): Promise<ConversationDto> {
    return chat(this.deps, userId, input).catch(toHttp);
  }
}
