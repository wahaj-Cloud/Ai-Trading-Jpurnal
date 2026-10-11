import type { Exchange, PrismaClient } from "@atc/db";
import { canonicalSymbol, type HistorySource } from "@atc/exchange-adapters";
import {
  attributeFunding,
  type DerivedPosition,
  fromExchangeRecord,
  reconstructPositions,
  withFunding,
  ZERO,
} from "@atc/trade-engine";

export interface AccountRef {
  id: string;
  userId: string;
  exchange: Exchange;
}

/** Journal keys are unique per user, so engine keys are namespaced by account. */
export const journalKey = (accountId: string, key: string) => `${accountId}|${key}`;

const MAX_LEVERAGE = 99_999_999;
/** Rebuilding a busy symbol can take longer than Prisma's 5 s default. */
const TX_OPTIONS = { maxWait: 10_000, timeout: 120_000 };

function positionRow(account: AccountRef, p: DerivedPosition, source: "FILLS" | "EXCHANGE") {
  const { base, quote, settle } = canonicalSymbol(account.exchange, p.symbol);
  const leverage =
    p.leverage === null ? null : Math.min(Number(p.leverage), MAX_LEVERAGE).toFixed(2);
  return {
    userId: account.userId,
    accountId: account.id,
    exchange: account.exchange,
    source,
    sourceKey: journalKey(account.id, p.sourceKey),
    symbol: p.symbol,
    baseAsset: base,
    quoteAsset: quote,
    settleAsset: p.settleAsset ?? settle,
    direction: p.direction,
    status: p.status,
    openedAt: p.openedAt,
    closedAt: p.closedAt,
    entryPrice: p.entryPrice,
    exitPrice: p.exitPrice,
    quantity: p.quantity,
    leverage,
    grossPnl: p.grossPnl,
    fees: p.fees,
    funding: p.funding,
    netPnl: p.netPnl,
    holdingSeconds: p.closedAt
      ? Math.max(0, Math.round((p.closedAt.getTime() - p.openedAt.getTime()) / 1000))
      : null,
    incompleteHistory: p.incompleteHistory,
  };
}

/**
 * Rebuilds the journal positions of one symbol from stored fills (Binance).
 *
 * With `changedFrom` (the earliest new fill or funding payment), only the part of history from the
 * last moment every position on the symbol was flat is rebuilt: positions that ended before it
 * cannot change. Without it the whole symbol is rebuilt. Both give identical results, so a busy
 * symbol's sync cost stays proportional to its new activity, not to its full history.
 */
export async function rebuildFromFills(
  db: PrismaClient,
  account: AccountRef,
  symbol: string,
  changedFrom?: Date,
): Promise<number> {
  const anchor = changedFrom ? await flatPointBefore(db, account.id, symbol, changedFrom) : null;
  const since = anchor ? { gte: anchor } : undefined;
  const fills = await db.fill.findMany({
    where: { accountId: account.id, symbol, ...(since ? { executedAt: since } : {}) },
    orderBy: { executedAt: "asc" },
    // The raw exchange payload is not needed to rebuild.
    select: {
      id: true,
      exchangeFillId: true,
      symbol: true,
      side: true,
      positionSide: true,
      price: true,
      qty: true,
      fee: true,
      realizedPnl: true,
      executedAt: true,
    },
  });
  if (fills.length === 0 && anchor) return 0;
  const fillIdByExchangeId = new Map(fills.map((f) => [f.exchangeFillId, f.id]));
  // Fills before the anchor exist: these fills do not start the symbol's history.
  const historyStart =
    !anchor ||
    (await db.fill.count({
      where: { accountId: account.id, symbol, executedAt: { lt: anchor } },
    })) === 0;

  const positions = reconstructPositions(
    fills.map((f) => ({
      id: f.exchangeFillId,
      symbol: f.symbol,
      side: f.side,
      positionSide: f.positionSide,
      price: f.price.toString(),
      qty: f.qty.toString(),
      fee: f.fee.toString(),
      realizedPnl: f.realizedPnl?.toString() ?? null,
      executedAt: f.executedAt,
    })),
    { historyStart },
  );

  const fundingEvents = await db.incomeEvent.findMany({
    where: {
      accountId: account.id,
      symbol,
      type: "FUNDING",
      ...(since ? { occurredAt: since } : {}),
    },
    select: { id: true, symbol: true, amount: true, occurredAt: true },
  });
  const { bySourceKey } = attributeFunding(
    positions,
    fundingEvents.map((e) => ({
      id: e.id,
      symbol: e.symbol ?? symbol,
      amount: e.amount.toString(),
      occurredAt: e.occurredAt,
    })),
  );

  await db.$transaction(async (tx) => {
    const keys: string[] = [];
    for (const reconstructed of positions) {
      const final = withFunding(reconstructed, bySourceKey.get(reconstructed.sourceKey) ?? ZERO);
      const row = positionRow(account, final, "FILLS");
      keys.push(row.sourceKey);
      const saved = await tx.position.upsert({
        where: { userId_sourceKey: { userId: account.userId, sourceKey: row.sourceKey } },
        create: row,
        update: row,
        select: { id: true },
      });
      await tx.positionFill.deleteMany({ where: { positionId: saved.id } });
      await tx.positionFill.createMany({
        data: reconstructed.allocations.flatMap((a) => {
          const fillId = fillIdByExchangeId.get(a.fillId);
          return fillId ? [{ positionId: saved.id, fillId, qty: a.qty, role: a.role }] : [];
        }),
      });
    }
    // Positions in the rebuilt range that no longer exist (e.g. an open position that became part
    // of a longer one once earlier fills arrived).
    await tx.position.deleteMany({
      where: {
        accountId: account.id,
        symbol,
        source: "FILLS",
        sourceKey: { notIn: keys },
        ...(since ? { openedAt: since } : {}),
      },
    });
  }, TX_OPTIONS);
  return positions.length;
}

/**
 * The latest moment at or before `t` when no position on the symbol was open: positions that span
 * `t` move it back to their opening, repeatedly, until nothing spans it.
 */
async function flatPointBefore(
  db: PrismaClient,
  accountId: string,
  symbol: string,
  t: Date,
): Promise<Date> {
  let anchor = t;
  for (let i = 0; i < 1_000; i++) {
    const spanning = await db.position.findFirst({
      where: {
        accountId,
        symbol,
        source: "FILLS",
        openedAt: { lt: anchor },
        OR: [{ closedAt: null }, { closedAt: { gte: anchor } }],
      },
      orderBy: { openedAt: "asc" },
      select: { openedAt: true },
    });
    if (!spanning) return anchor;
    anchor = spanning.openedAt;
  }
  return new Date(0); // pathological overlap chain: rebuild everything
}

/** Rebuilds journal positions of one symbol from the exchange's own position records. */
export async function rebuildFromExchange(
  db: PrismaClient,
  account: AccountRef,
  source: HistorySource,
  symbol: string,
): Promise<number> {
  const raws = await db.exchangePosition.findMany({ where: { accountId: account.id, symbol } });
  const records = source.toRecords(
    raws.map((r) => ({
      externalId: r.externalId,
      symbol: r.symbol,
      closed: r.closed,
      closedAt: r.closedAt,
      raw: r.raw as Record<string, unknown>,
    })),
  );
  const rows = records.map((r) => positionRow(account, fromExchangeRecord(r), "EXCHANGE"));

  await db.$transaction(async (tx) => {
    for (const row of rows) {
      await tx.position.upsert({
        where: { userId_sourceKey: { userId: account.userId, sourceKey: row.sourceKey } },
        create: row,
        update: row,
      });
    }
    await tx.position.deleteMany({
      where: {
        accountId: account.id,
        symbol,
        source: "EXCHANGE",
        sourceKey: { notIn: rows.map((r) => r.sourceKey) },
      },
    });
  }, TX_OPTIONS);
  return rows.length;
}
