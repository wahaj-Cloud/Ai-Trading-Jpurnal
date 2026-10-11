import type { Prisma, PrismaClient } from "@atc/db";
import type {
  BehaviourFlagDto,
  ContextCheckCode,
  ExchangeId,
  StrategyInsightDto,
  Timeframe,
  TradeContextDto,
} from "@atc/shared";
import {
  analyzeTrade,
  type Candle,
  CONTEXT_VERSION,
  TIMEFRAME_MS,
  timeframeFor,
  WARMUP_CANDLES,
} from "@atc/ta";
import { dec, str, ZERO } from "@atc/trade-engine";

/** Downloads public candles for a trade's exchange (injected: the worker adds rate limiting). */
export type CandleSource = (
  exchange: ExchangeId,
  position: { symbol: string; baseAsset: string; quoteAsset: string },
  timeframe: Timeframe,
  from: number,
  to: number,
) => Promise<Candle[]>;

type ContextRow = Prisma.TradeContextGetPayload<object>;

export function storedContext(row: ContextRow | null): TradeContextDto | null {
  return row?.status === "DONE" && row.context ? (row.context as unknown as TradeContextDto) : null;
}

/**
 * The market context of a closed trade: from the database when already computed, otherwise from
 * fresh candles (then stored). Returns null when there is not enough market history.
 */
export async function ensureContext(
  db: PrismaClient,
  candles: CandleSource,
  userId: string,
  positionId: string,
  opts: { force?: boolean } = {},
): Promise<TradeContextDto | null> {
  const p = await db.position.findFirst({
    where: { id: positionId, userId },
    select: {
      sourceKey: true,
      accountId: true,
      exchange: true,
      symbol: true,
      baseAsset: true,
      quoteAsset: true,
      direction: true,
      openedAt: true,
      closedAt: true,
      entryPrice: true,
      exitPrice: true,
      holdingSeconds: true,
      incompleteHistory: true,
    },
  });
  if (!p?.entryPrice) return null;
  const key = { userId_positionKey: { userId, positionKey: p.sourceKey } };
  const existing = await db.tradeContext.findUnique({ where: key });
  if (existing && existing.version === CONTEXT_VERSION && !opts.force)
    return storedContext(existing);

  const journal = await db.journalEntry.findUnique({
    where: { userId_positionKey: { userId, positionKey: p.sourceKey } },
    select: { stopPrice: true },
  });
  const timeframe = timeframeFor(p.holdingSeconds);
  const step = TIMEFRAME_MS[timeframe];
  const from = p.openedAt.getTime() - WARMUP_CANDLES * step;
  const to = (p.closedAt ?? p.openedAt).getTime() + 2 * step;
  let series: Candle[];
  try {
    series = await candles(p.exchange, p, timeframe, from, to);
  } catch (err) {
    // The exchange refused (e.g. delisted symbol): record it instead of retrying forever.
    // Rate limits and outages are rethrown so the queue retries later.
    const status = (err as { status?: number }).status ?? 0;
    if (status < 400 || status >= 500 || status === 429) throw err;
    series = [];
  }
  const ctx = analyzeTrade(
    series,
    {
      direction: p.direction,
      openedAt: p.openedAt,
      closedAt: p.closedAt,
      entryPrice: Number(p.entryPrice),
      exitPrice: p.exitPrice === null ? null : Number(p.exitPrice),
      stopPrice: journal?.stopPrice ? Number(journal.stopPrice) : null,
    },
    timeframe,
    p.exchange,
  );
  const data = ctx
    ? {
        status: "DONE" as const,
        timeframe,
        context: ctx as unknown as Prisma.InputJsonValue,
        error: null,
      }
    : {
        status: "UNAVAILABLE" as const,
        timeframe,
        context: undefined,
        error: "Not enough market history for this trade",
      };
  await db.tradeContext.upsert({
    where: key,
    create: {
      userId,
      accountId: p.accountId,
      positionKey: p.sourceKey,
      version: CONTEXT_VERSION,
      ...data,
    },
    update: { version: CONTEXT_VERSION, computedAt: new Date(), ...data },
  });
  return ctx;
}

/** Behaviour evidence the market adds: chasing an extended move is FOMO even if not journaled. */
export function marketFlags(positionId: string, ctx: TradeContextDto | null): BehaviourFlagDto[] {
  if (!ctx?.extendedEntry) return [];
  const e = ctx.entry;
  return [
    {
      code: "FOMO",
      severity: "MEDIUM",
      evidence: `Entry chased the move: ${e.stretchAtr === null ? "" : `${Math.abs(e.stretchAtr).toFixed(1)} ATR from the 20 EMA`}${e.rsi === null ? "" : `, RSI ${e.rsi.toFixed(0)}`} on the ${ctx.timeframe} chart.`,
      positionIds: [positionId],
    },
  ];
}

const INSIGHT_CODES: ContextCheckCode[] = [
  "TREND_ALIGNED",
  "EMA_ALIGNED",
  "VALUE_ENTRY",
  "NOT_EXTENDED",
  "PREMIUM_DISCOUNT",
  "STRUCTURE_CONFIRMED",
  "ZONE_CONFLUENCE",
  "VOLUME_CONFIRMED",
  "EXIT_EFFICIENCY",
  "HELD_GAINS",
];

/**
 * How results differ when each entry/exit condition held or not, across the trader's analysed
 * trades: e.g. "trend-aligned trades won 62%, counter-trend trades 31%".
 */
export async function strategyInsights(
  db: PrismaClient,
  userId: string,
  from: Date,
): Promise<StrategyInsightDto[]> {
  const contexts = await db.tradeContext.findMany({ where: { userId, status: "DONE" } });
  if (contexts.length === 0) return [];
  const positions = await db.position.findMany({
    where: {
      userId,
      status: "CLOSED",
      closedAt: { gte: from },
      sourceKey: { in: contexts.map((c) => c.positionKey) },
      netPnl: { not: null },
    },
    select: { sourceKey: true, netPnl: true, settleAsset: true, quoteAsset: true },
  });
  const pnlByKey = new Map(
    positions
      .filter((p) => p.settleAsset === p.quoteAsset)
      .map((p) => [p.sourceKey, dec(p.netPnl?.toString() ?? "0")]),
  );
  type Acc = { trades: number; wins: number; losses: number; pnl: typeof ZERO };
  const empty = (): Acc => ({ trades: 0, wins: 0, losses: 0, pnl: ZERO });
  const acc = new Map<ContextCheckCode, { label: string; yes: Acc; no: Acc }>();
  for (const c of contexts) {
    const pnl = pnlByKey.get(c.positionKey);
    if (!pnl) continue;
    const ctx = c.context as unknown as TradeContextDto;
    for (const check of ctx.checks) {
      if (check.ok === null || !INSIGHT_CODES.includes(check.code)) continue;
      const a = acc.get(check.code) ?? { label: check.label, yes: empty(), no: empty() };
      const side = check.ok ? a.yes : a.no;
      side.trades += 1;
      if (pnl.gt(0)) side.wins += 1;
      else if (pnl.lt(0)) side.losses += 1;
      side.pnl = side.pnl.plus(pnl);
      acc.set(check.code, a);
    }
  }
  const out = (a: Acc) => ({
    trades: a.trades,
    winRate: a.wins + a.losses ? Number((a.wins / (a.wins + a.losses)).toFixed(4)) : null,
    netPnl: str(a.pnl.toDecimalPlaces(8)),
  });
  return INSIGHT_CODES.flatMap((code) => {
    const a = acc.get(code);
    return a ? [{ code, label: a.label, withCheck: out(a.yes), againstCheck: out(a.no) }] : [];
  });
}
