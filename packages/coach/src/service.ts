import { addDays, computeAnalytics, localParts, startOfLocalDay } from "@atc/analytics";
import type { Prisma, PrismaClient } from "@atc/db";
import {
  AI_COST_METRIC,
  aiCostMicros,
  type BehaviourFlagDto,
  type BehaviourSummaryDto,
  type CoachNoteDto,
  type CoachStatusDto,
  type ConversationDto,
  type Grade,
  type PlanLimits,
  type PsychologyReportDto,
  type TradeReviewDto,
  UNLIMITED,
} from "@atc/shared";
import { contextFacts } from "@atc/ta";
import { behaviourSummary, type Detection, detectBehaviours } from "./behaviour.js";
import { type CandleSource, ensureContext, marketFlags, storedContext } from "./context.js";
import {
  addUsage,
  loadCoachTrades,
  planLimits,
  releaseUsage,
  reserveUsage,
  reviewInputHash,
  usageCount,
  userTimeZone,
} from "./data.js";
import { weekStart } from "./dates.js";
import { edgeFacts, periodFacts, recentTradesFacts, tradeFacts } from "./facts.js";
import { type GradeResult, gradeTrade } from "./grade.js";
import { AiRequestError, AiUnavailableError, type CoachModel } from "./model.js";
import {
  CHAT_SYSTEM,
  NOTE_SYSTEM,
  type NoteOutput,
  noteOutput,
  PROMPT_VERSION,
  schemaOf,
  TRADE_REVIEW_SYSTEM,
  type TradeReviewOutput,
  tradeReviewOutput,
} from "./prompts.js";
import { psychologyFact, psychologyReport } from "./psychology.js";
import type { CoachTrade } from "./types.js";

export interface CoachDeps {
  db: PrismaClient;
  model: CoachModel;
  now?: () => Date;
  /** Public candles (worker only). Without it, reviews use market context already stored, if any. */
  candles?: CandleSource;
}

export class CoachLimitError extends Error {
  constructor(readonly metric: "reviews" | "messages" | "notes" | "budget") {
    super(
      metric === "reviews"
        ? "You have used this month's AI reviews on your plan."
        : metric === "notes"
          ? `You can ask for ${NOTE_REQUESTS_PER_DAY} coaching notes a day. Try again tomorrow.`
          : metric === "budget"
            ? "You have used this month's AI allowance on your plan. It resets on the 1st, or upgrade for more."
            : "You have used today's coach messages on your plan.",
    );
    this.name = "CoachLimitError";
  }
}

export class CoachNotFoundError extends Error {
  constructor(what = "Not found") {
    super(what);
    this.name = "CoachNotFoundError";
  }
}

const METRIC_REVIEW = "ai_trade_review";
const METRIC_NOTE = "ai_coach_note";
const METRIC_MESSAGE = "coach_message";
const BASELINE_DAYS = 30;
const DAY_MS = 86_400_000;
const CHAT_HISTORY = 20;

const nowOf = (deps: CoachDeps) => deps.now?.() ?? new Date();
/** Allowances reset on UTC days and months, so changing timezone cannot stretch them. */
const usagePeriod = (deps: CoachDeps) => {
  const iso = nowOf(deps).toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
};
/** On-demand coaching notes per UTC day ("Coach me on this day"). */
export const NOTE_REQUESTS_PER_DAY = 10;
const METRIC_NOTE_REQUEST = "ai_coach_note_request";

// ─── AI spend ───

/** True while the user's AI spend this month is under their plan's budget. */
export async function aiBudgetLeft(
  db: PrismaClient,
  userId: string,
  limits: PlanLimits,
  month: string,
): Promise<boolean> {
  if (limits.aiBudgetUsd === UNLIMITED) return true;
  if (limits.aiBudgetUsd <= 0) return false;
  const spent = await usageCount(db, userId, AI_COST_METRIC, month);
  return spent < limits.aiBudgetUsd * 1_000_000;
}

/** Records what one model call cost against the user's month. Never fails the caller. */
export async function recordAiCost(
  db: PrismaClient,
  userId: string,
  month: string,
  res: { model: string; inputTokens: number; outputTokens: number },
): Promise<void> {
  await addUsage(
    db,
    userId,
    AI_COST_METRIC,
    month,
    aiCostMicros(res.model, res.inputTokens, res.outputTokens),
  ).catch(() => undefined);
}

/** The model, with every call's cost charged to this user (retries included). */
function meteredModel(deps: CoachDeps, userId: string, month: string): CoachModel {
  return {
    enabled: deps.model.enabled,
    async complete(req) {
      const res = await deps.model.complete(req);
      await recordAiCost(deps.db, userId, month, res);
      return res;
    },
  };
}

// ─── Trade reviews ───

export interface TradeEvaluation {
  trade: CoachTrade & { accountId: string | null };
  grade: GradeResult;
  flags: BehaviourFlagDto[];
  hash: string;
  timeZone: string;
}

/** Rules-based evaluation of one trade against the trader's previous 30 days. Free and instant. */
export async function evaluateTrade(
  db: PrismaClient,
  userId: string,
  positionId: string,
): Promise<TradeEvaluation | null> {
  const position = await db.position.findFirst({
    where: { id: positionId, userId, status: "CLOSED", closedAt: { not: null } },
    select: { closedAt: true },
  });
  if (!position?.closedAt) return null;
  const closedAt = position.closedAt;
  const timeZone = await userTimeZone(db, userId);
  // Only what the trader knew when this trade closed: later trades never change its grade.
  const window = await loadCoachTrades(db, userId, {
    from: new Date(closedAt.getTime() - BASELINE_DAYS * DAY_MS),
    to: new Date(closedAt.getTime() + 1),
  });
  const trade = window.find((t) => t.id === positionId);
  if (!trade) return null;
  const detection = detectBehaviours(window, {
    timeZone,
    from: trade.closedAt,
    to: new Date(trade.closedAt.getTime() + 1),
  });
  const context = storedContext(
    await db.tradeContext.findUnique({
      where: { userId_positionKey: { userId, positionKey: trade.sourceKey } },
    }),
  );
  const flags = [...(detection.byTrade.get(trade.id) ?? [])];
  for (const f of marketFlags(trade.id, context)) {
    if (!flags.some((x) => x.code === f.code)) flags.push(f);
  }
  return {
    trade,
    grade: gradeTrade(trade, flags),
    flags,
    hash: reviewInputHash(trade),
    timeZone,
  };
}

type ReviewRow = Prisma.TradeReviewGetPayload<object>;

export function reviewDto(
  evaluation: TradeEvaluation,
  row: ReviewRow | null,
  aiEnabled: boolean,
): TradeReviewDto {
  const done = row?.status === "DONE";
  return {
    status: !aiEnabled && !done ? "UNAVAILABLE" : (row?.status ?? "NONE"),
    grade: evaluation.grade.grade,
    score: evaluation.grade.score,
    gradeFactors: evaluation.grade.factors,
    flags: evaluation.flags,
    summary: done ? row.summary : null,
    entryAnalysis: done ? row.entryAnalysis : null,
    exitAnalysis: done ? row.exitAnalysis : null,
    riskAnalysis: done ? row.riskAnalysis : null,
    strategyAnalysis: done ? row.strategyAnalysis : null,
    mistakes: done ? row.mistakes : [],
    positives: done ? row.positives : [],
    nextTime: done ? row.nextTime : null,
    stale: done && row.inputHash !== evaluation.hash,
    generatedAt: row?.generatedAt?.toISOString() ?? null,
    error: row?.status === "FAILED" ? row.error : null,
  };
}

async function toolCall<T>(
  model: CoachModel,
  req: Parameters<CoachModel["complete"]>[0],
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
) {
  // One retry when the model returns something that does not match the required shape.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await model.complete(req);
    const parsed = schema.safeParse(res.toolInput);
    if (parsed.success) return { data: parsed.data, res };
  }
  throw new AiRequestError(422, "The AI answer did not match the expected format", true);
}

/**
 * Writes (or refreshes) the AI review of one closed trade. Idempotent: an up-to-date review is kept
 * unless `force` is set. Usage is reserved before the model call and given back if the call fails.
 */
export async function reviewTrade(
  deps: CoachDeps,
  userId: string,
  positionId: string,
  opts: { force?: boolean; finalAttempt?: boolean } = {},
): Promise<TradeReviewDto | null> {
  const { db, model } = deps;
  // Market context first (worker): its findings (e.g. chasing) are part of the grade.
  if (deps.candles && model.enabled) {
    await ensureContext(db, deps.candles, userId, positionId).catch(() => null);
  }
  const evaluation = await evaluateTrade(db, userId, positionId);
  if (!evaluation) return null;
  const { trade, grade, flags, hash } = evaluation;
  const key = { userId_positionKey: { userId, positionKey: trade.sourceKey } };
  const existing = await db.tradeReview.findUnique({ where: key });
  if (existing?.status === "DONE" && existing.inputHash === hash && !opts.force) {
    return reviewDto(evaluation, existing, model.enabled);
  }
  if (!model.enabled) throw new AiUnavailableError();

  const base = {
    grade: grade.grade,
    score: grade.score,
    gradeFactors: grade.factors,
    flags: flags as unknown as Prisma.InputJsonValue,
    inputHash: hash,
  };
  const { month } = usagePeriod(deps);
  const limits = await planLimits(db, userId);
  if (
    !(await aiBudgetLeft(db, userId, limits, month)) ||
    !(await reserveUsage(db, userId, METRIC_REVIEW, month, limits.aiReviewsPerMonth))
  ) {
    const row = await db.tradeReview.upsert({
      where: key,
      create: {
        userId,
        accountId: trade.accountId,
        positionKey: trade.sourceKey,
        status: "LIMIT_REACHED",
        ...base,
      },
      // Keep a previous finished review readable; only record the limit when there is none.
      update: existing?.status === "DONE" ? {} : { status: "LIMIT_REACHED", ...base },
    });
    return reviewDto(evaluation, row, model.enabled);
  }

  try {
    const ctx = storedContext(
      await db.tradeContext.findUnique({
        where: { userId_positionKey: { userId, positionKey: trade.sourceKey } },
      }),
    );
    const marketContext = ctx ? contextFacts(ctx) : null;
    const { data, res } = await toolCall<TradeReviewOutput>(
      meteredModel(deps, userId, month),
      {
        tier: "fast",
        system: TRADE_REVIEW_SYSTEM,
        messages: [
          {
            role: "user",
            content: tradeFacts(trade, grade, flags, {
              marketContext,
              timeZone: evaluation.timeZone,
            }),
          },
        ],
        maxTokens: 900,
        tool: {
          name: "record_trade_review",
          description: "Record the coaching review of this trade.",
          schema: schemaOf(tradeReviewOutput),
        },
      },
      tradeReviewOutput,
    );
    const fields = {
      ...base,
      status: "DONE" as const,
      summary: data.summary,
      entryAnalysis: data.entryAnalysis,
      exitAnalysis: data.exitAnalysis,
      riskAnalysis: data.riskAnalysis,
      strategyAnalysis: marketContext ? data.strategyAnalysis : null,
      mistakes: data.mistakes,
      positives: data.positives,
      nextTime: data.nextTime,
      model: res.model,
      promptVersion: PROMPT_VERSION,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      error: null,
      generatedAt: nowOf(deps),
    };
    const row = await db.tradeReview.upsert({
      where: key,
      create: { userId, accountId: trade.accountId, positionKey: trade.sourceKey, ...fields },
      update: fields,
    });
    return reviewDto(evaluation, row, model.enabled);
  } catch (err) {
    await releaseUsage(db, userId, METRIC_REVIEW, month);
    // Temporary failures are retried by the queue; the last attempt records the failure so the
    // page stops waiting and offers "Try again".
    if (err instanceof AiRequestError && err.retryable && !opts.finalAttempt) throw err;
    const message = err instanceof Error ? err.message.slice(0, 300) : "AI review failed";
    await db.tradeReview.upsert({
      where: key,
      create: {
        userId,
        accountId: trade.accountId,
        positionKey: trade.sourceKey,
        status: "FAILED",
        error: message,
        ...base,
      },
      update:
        existing?.status === "DONE"
          ? { error: message }
          : { status: "FAILED", error: message, ...base },
    });
    throw err;
  }
}

/** Marks a review as queued so the page can show "Writing your review…". */
export async function markReviewPending(
  db: PrismaClient,
  evaluation: TradeEvaluation,
  userId: string,
): Promise<void> {
  const key = { userId_positionKey: { userId, positionKey: evaluation.trade.sourceKey } };
  const base = {
    grade: evaluation.grade.grade,
    score: evaluation.grade.score,
    gradeFactors: evaluation.grade.factors,
    flags: evaluation.flags as unknown as Prisma.InputJsonValue,
    inputHash: evaluation.hash,
  };
  await db.tradeReview.upsert({
    where: key,
    create: {
      userId,
      accountId: evaluation.trade.accountId,
      positionKey: evaluation.trade.sourceKey,
      status: "PENDING",
      ...base,
    },
    update: { status: "PENDING", error: null },
  });
}

// ─── Coaching notes ───

function noteRange(kind: "DAILY" | "WEEKLY", period: string, timeZone: string) {
  const days = kind === "DAILY" ? 1 : 7;
  return {
    from: startOfLocalDay(period, timeZone),
    to: startOfLocalDay(addDays(period, days), timeZone),
    label:
      kind === "DAILY"
        ? `the trading day ${period}`
        : `the week ${period} to ${addDays(period, 6)}`,
  };
}

type NoteRow = Prisma.CoachNoteGetPayload<object>;

export function noteDto(row: NoteRow): CoachNoteDto {
  const content = row.content as unknown as NoteOutput;
  return {
    id: row.id,
    kind: row.kind,
    period: row.period,
    headline: content.headline,
    wentWell: content.wentWell,
    costMoney: content.costMoney,
    focus: content.focus,
    flags: row.flags as unknown as BehaviourFlagDto[],
    stats: row.stats as unknown as CoachNoteDto["stats"],
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Writes the coaching note for one day or week. Returns null when there were no closed trades.
 * Existing notes are kept (one per period) unless `force` is set.
 */
export async function writeNote(
  deps: CoachDeps,
  userId: string,
  kind: "DAILY" | "WEEKLY",
  period: string,
  opts: { force?: boolean; onDemand?: boolean } = {},
): Promise<CoachNoteDto | null> {
  const { db, model } = deps;
  const existing = await db.coachNote.findUnique({
    where: { userId_kind_period: { userId, kind, period } },
  });
  if (existing && !opts.force) return noteDto(existing);
  if (!model.enabled) throw new AiUnavailableError();

  const timeZone = await userTimeZone(db, userId);
  const range = noteRange(kind, period, timeZone);
  const all = await loadCoachTrades(db, userId, {
    from: new Date(range.from.getTime() - BASELINE_DAYS * DAY_MS),
    to: range.to,
  });
  const inPeriod = all.filter((t) => t.closedAt >= range.from && t.closedAt < range.to);
  if (inPeriod.length === 0) return null;
  const baseline = all.filter((t) => t.closedAt < range.from);
  const detection = detectBehaviours(all, { timeZone, from: range.from, to: range.to });
  const reportOf = (trades: CoachTrade[]) =>
    computeAnalytics(
      trades.map((t) => ({
        ...t,
        funding: null,
        mistakes: t.journal?.mistakes,
        setup: t.journal?.setup,
      })),
      { timeZone, now: nowOf(deps), range: { from: null, to: null, timezone: timeZone } },
    );
  const report = reportOf(inPeriod);

  const limits = await planLimits(db, userId);
  if (limits.aiReviewsPerMonth === 0) throw new CoachLimitError("reviews");
  const { day, month } = usagePeriod(deps);
  if (!(await aiBudgetLeft(db, userId, limits, month))) throw new CoachLimitError("budget");
  if (
    opts.onDemand &&
    !(await reserveUsage(db, userId, METRIC_NOTE_REQUEST, day, NOTE_REQUESTS_PER_DAY))
  ) {
    throw new CoachLimitError("notes");
  }
  // Notes are included with any AI plan; counted for cost monitoring.
  await reserveUsage(db, userId, METRIC_NOTE, month, -1);
  const call = toolCall<NoteOutput>(
    meteredModel(deps, userId, month),
    {
      tier: "fast",
      system: NOTE_SYSTEM,
      messages: [
        {
          role: "user",
          content: `${periodFacts(range.label, report, detection.flags, baseline.length ? reportOf(baseline) : null)}\n\n${recentTradesFacts(inPeriod, timeZone, 25)}\n\n${edgeFacts(inPeriod, await usesSetups(db, userId))}`,
        },
      ],
      maxTokens: 700,
      tool: {
        name: "record_coaching_note",
        description: "Record the coaching note.",
        schema: schemaOf(noteOutput),
      },
    },
    noteOutput,
  );
  const { data, res } = await call.catch(async (err: unknown) => {
    await releaseUsage(db, userId, METRIC_NOTE, month);
    if (opts.onDemand) await releaseUsage(db, userId, METRIC_NOTE_REQUEST, day);
    throw err;
  });
  const fields = {
    content: data as unknown as Prisma.InputJsonValue,
    flags: detection.flags as unknown as Prisma.InputJsonValue,
    stats: {
      trades: report.summary.trades,
      netPnl: report.summary.netPnl,
      winRate: report.summary.winRate,
    },
    model: res.model,
    promptVersion: PROMPT_VERSION,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
  };
  const row = await db.coachNote.upsert({
    where: { userId_kind_period: { userId, kind, period } },
    create: { userId, kind, period, ...fields },
    update: fields,
  });
  return noteDto(row);
}

// ─── Behaviour summary (dashboard) ───

export async function behaviourForPeriod(
  db: PrismaClient,
  userId: string,
  days: number,
  now = new Date(),
): Promise<BehaviourSummaryDto> {
  const timeZone = await userTimeZone(db, userId);
  const today = localParts(now, timeZone).date;
  const fromDay = addDays(today, 1 - days);
  const from = startOfLocalDay(fromDay, timeZone);
  const trades = await loadCoachTrades(db, userId, {
    from: new Date(from.getTime() - BASELINE_DAYS * DAY_MS),
  });
  const detection: Detection = detectBehaviours(trades, {
    timeZone,
    from,
    to: new Date(now.getTime() + DAY_MS),
  });
  return behaviourSummary(detection, trades, { from: fromDay, to: today });
}

/**
 * Psychology report for the last `days` days. Detection runs once over the 8-week trend plus the
 * period (whichever is longer), with the usual baseline before it.
 */
export async function psychologyForPeriod(
  db: PrismaClient,
  userId: string,
  days: number,
  now = new Date(),
): Promise<PsychologyReportDto> {
  const timeZone = await userTimeZone(db, userId);
  const today = localParts(now, timeZone).date;
  const fromDay = addDays(today, 1 - days);
  const trendStart = addDays(weekStart(today), -7 * 7);
  const detectFromDay = fromDay < trendStart ? fromDay : trendStart;
  const detectFrom = startOfLocalDay(detectFromDay, timeZone);
  const to = startOfLocalDay(addDays(today, 1), timeZone);
  const trades = await loadCoachTrades(db, userId, {
    from: new Date(detectFrom.getTime() - BASELINE_DAYS * DAY_MS),
  });
  const detection = detectBehaviours(trades, { timeZone, from: detectFrom, to });
  return psychologyReport(trades, detection, {
    timeZone,
    from: startOfLocalDay(fromDay, timeZone),
    to,
    fromDay,
    toDay: today,
  });
}

// ─── Chat ───

export async function coachStatus(deps: CoachDeps, userId: string): Promise<CoachStatusDto> {
  const period = usagePeriod(deps);
  const limits = await planLimits(deps.db, userId);
  return {
    aiEnabled: deps.model.enabled,
    usage: {
      reviewsThisMonth: await usageCount(deps.db, userId, METRIC_REVIEW, period.month),
      reviewsLimit: limits.aiReviewsPerMonth,
      messagesToday: await usageCount(deps.db, userId, METRIC_MESSAGE, period.day),
      messagesLimit: limits.coachMessagesPerDay,
      aiSpentUsd: (await usageCount(deps.db, userId, AI_COST_METRIC, period.month)) / 1_000_000,
      aiBudgetUsd: limits.aiBudgetUsd,
    },
  };
}

/** Everything the coach may cite in chat, computed fresh for every question. */
async function chatFacts(deps: CoachDeps, userId: string, timeZone: string): Promise<string> {
  const now = nowOf(deps);
  const today = localParts(now, timeZone).date;
  const thisWeek = weekStart(today);
  const lastWeek = addDays(thisWeek, -7);
  const from30 = addDays(today, -29);
  const trades = await loadCoachTrades(deps.db, userId, {
    from: startOfLocalDay(addDays(from30, -BASELINE_DAYS), timeZone),
  });
  const between = (a: string, b: string) => {
    const f = startOfLocalDay(a, timeZone);
    const t = startOfLocalDay(b, timeZone);
    return trades.filter((x) => x.closedAt >= f && x.closedAt < t);
  };
  const report = (list: CoachTrade[]) =>
    computeAnalytics(
      list.map((t) => ({
        ...t,
        funding: null,
        mistakes: t.journal?.mistakes,
        setup: t.journal?.setup,
        emotions: t.journal?.emotions,
      })),
      { timeZone, now, range: { from: null, to: null, timezone: timeZone } },
    );
  const tomorrow = addDays(today, 1);
  const last30 = between(from30, tomorrow);
  const detection = detectBehaviours(trades, {
    timeZone,
    from: startOfLocalDay(from30, timeZone),
    to: startOfLocalDay(tomorrow, timeZone),
  });
  const todayFlags = detectBehaviours(trades, {
    timeZone,
    from: startOfLocalDay(today, timeZone),
    to: startOfLocalDay(tomorrow, timeZone),
  }).flags;
  const notes = await deps.db.coachNote.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  return [
    `Today is ${today} (${timeZone}). Weeks start on Monday.`,
    periodFacts(`TODAY ${today}`, report(between(today, tomorrow)), todayFlags, null),
    periodFacts(`THIS WEEK from ${thisWeek}`, report(between(thisWeek, tomorrow)), [], null),
    periodFacts(
      `LAST WEEK ${lastWeek} to ${addDays(thisWeek, -1)}`,
      report(between(lastWeek, thisWeek)),
      [],
      null,
    ),
    periodFacts(`LAST 30 DAYS from ${from30}`, report(last30), detection.flags, null),
    psychologyFact(
      psychologyReport(trades, detection, {
        timeZone,
        from: startOfLocalDay(from30, timeZone),
        to: startOfLocalDay(tomorrow, timeZone),
        fromDay: from30,
        toDay: today,
      }),
    ) ?? "",
    recentTradesFacts(last30, timeZone, 20),
    edgeFacts(trades, await usesSetups(deps.db, userId)),
    notes.length
      ? `RECENT COACHING NOTES\n${notes
          .map((n) => {
            const c = n.content as unknown as NoteOutput;
            return `- ${n.kind.toLowerCase()} ${n.period}: ${c.headline} Focus: ${c.focus}`;
          })
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function chat(
  deps: CoachDeps,
  userId: string,
  input: { conversationId?: string; message: string },
): Promise<ConversationDto> {
  const { db, model } = deps;
  if (!model.enabled) throw new AiUnavailableError();
  const conversation = input.conversationId
    ? await db.coachConversation.findFirst({ where: { id: input.conversationId, userId } })
    : null;
  if (input.conversationId && !conversation) throw new CoachNotFoundError("Conversation not found");

  const timeZone = await userTimeZone(db, userId);
  const { day, month } = usagePeriod(deps);
  const limits = await planLimits(db, userId);
  if (!(await aiBudgetLeft(db, userId, limits, month))) throw new CoachLimitError("budget");
  if (!(await reserveUsage(db, userId, METRIC_MESSAGE, day, limits.coachMessagesPerDay))) {
    throw new CoachLimitError("messages");
  }

  try {
    const history = conversation
      ? await db.coachMessage.findMany({
          where: { conversationId: conversation.id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: CHAT_HISTORY,
        })
      : [];
    const facts = await chatFacts(deps, userId, timeZone);
    const res = await meteredModel(deps, userId, month).complete({
      tier: "smart",
      system: `${CHAT_SYSTEM}\n\n<facts>\n${facts}\n</facts>`,
      messages: [
        ...history.reverse().map((m) => ({
          role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
          content: m.content,
        })),
        { role: "user" as const, content: input.message },
      ],
      maxTokens: 800,
    });
    const answer = res.text.trim() || "Sorry, I could not produce an answer. Please try again.";

    const saved = await db.$transaction(async (tx) => {
      const conv =
        conversation ??
        (await tx.coachConversation.create({
          data: { userId, title: input.message.replace(/\s+/g, " ").slice(0, 80) },
        }));
      await tx.coachMessage.create({
        data: { conversationId: conv.id, role: "USER", content: input.message },
      });
      await tx.coachMessage.create({
        data: {
          conversationId: conv.id,
          role: "ASSISTANT",
          content: answer,
          model: res.model,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
        },
      });
      return tx.coachConversation.update({
        where: { id: conv.id },
        data: { updatedAt: nowOf(deps) },
      });
    });
    return getConversation(db, userId, saved.id);
  } catch (err) {
    await releaseUsage(db, userId, METRIC_MESSAGE, day);
    throw err;
  }
}

export async function getConversation(
  db: PrismaClient,
  userId: string,
  id: string,
): Promise<ConversationDto> {
  const conv = await db.coachConversation.findFirst({
    where: { id, userId },
    // IDs are time-ordered (UUIDv7): they break ties between messages saved in one transaction.
    include: { messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!conv) throw new CoachNotFoundError("Conversation not found");
  return {
    id: conv.id,
    title: conv.title,
    updatedAt: conv.updatedAt.toISOString(),
    messages: conv.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export type { Grade };
export { weekStart };

/** Whether the trader has ever saved a setup (planned vs unplanned only means something then). */
async function usesSetups(db: CoachDeps["db"], userId: string): Promise<boolean> {
  return (await db.setup.count({ where: { userId } })) > 0;
}
