import type { Prisma, PrismaClient } from "@atc/db";
import type { HistoryBatch } from "@atc/exchange-adapters";

const CHUNK = 200;

export interface SaveResult {
  fillsInserted: number;
  incomeInserted: number;
  positionsSaved: number;
  /** Symbols whose journal positions must be rebuilt. */
  symbols: Set<string>;
  /** Per symbol, the earliest fill or funding time in this batch (incremental rebuilds start here). */
  changedFrom: Map<string, Date>;
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

/**
 * Stores one downloaded batch. Fills and ledger entries are immutable: re-downloading them is a
 * no-op (unique per account). Exchange position records change while a position is open, so they
 * are upserted.
 */
export async function saveBatch(
  db: PrismaClient,
  accountId: string,
  batch: HistoryBatch,
): Promise<SaveResult> {
  let fillsInserted = 0;
  for (let i = 0; i < batch.fills.length; i += CHUNK) {
    const { count } = await db.fill.createMany({
      skipDuplicates: true,
      data: batch.fills.slice(i, i + CHUNK).map((f) => ({
        accountId,
        exchangeFillId: f.exchangeFillId,
        orderId: f.orderId,
        symbol: f.symbol,
        side: f.side,
        positionSide: f.positionSide,
        price: f.price,
        qty: f.qty,
        fee: f.fee,
        feeAsset: f.feeAsset,
        realizedPnl: f.realizedPnl,
        isMaker: f.isMaker,
        executedAt: f.executedAt,
        raw: json(f.raw),
      })),
    });
    fillsInserted += count;
  }

  let incomeInserted = 0;
  for (let i = 0; i < batch.income.length; i += CHUNK) {
    const { count } = await db.incomeEvent.createMany({
      skipDuplicates: true,
      data: batch.income.slice(i, i + CHUNK).map((e) => ({
        accountId,
        externalId: e.externalId,
        type: e.type,
        amount: e.amount,
        asset: e.asset,
        symbol: e.symbol,
        occurredAt: e.occurredAt,
        raw: json(e.raw),
      })),
    });
    incomeInserted += count;
  }

  for (let i = 0; i < batch.positions.length; i += CHUNK) {
    await db.$transaction(
      batch.positions.slice(i, i + CHUNK).map((p) =>
        db.exchangePosition.upsert({
          select: { id: true },
          where: { accountId_externalId: { accountId, externalId: p.externalId } },
          create: {
            accountId,
            externalId: p.externalId,
            symbol: p.symbol,
            closed: p.closed,
            closedAt: p.closedAt,
            raw: json(p.raw),
          },
          update: {
            closed: p.closed,
            closedAt: p.closedAt,
            raw: json(p.raw),
            fetchedAt: new Date(),
          },
        }),
      ),
    );
  }

  const symbols = new Set<string>([
    ...batch.fills.map((f) => f.symbol),
    ...batch.positions.map((p) => p.symbol),
    // New funding changes a fills-based position's net PnL.
    ...batch.income.filter((e) => e.type === "FUNDING" && e.symbol).map((e) => e.symbol as string),
  ]);
  const changedFrom = new Map<string, Date>();
  const touch = (symbol: string, at: Date) => {
    const prev = changedFrom.get(symbol);
    if (!prev || at < prev) changedFrom.set(symbol, at);
  };
  for (const f of batch.fills) touch(f.symbol, f.executedAt);
  for (const e of batch.income) if (e.type === "FUNDING" && e.symbol) touch(e.symbol, e.occurredAt);
  return {
    fillsInserted,
    incomeInserted,
    positionsSaved: batch.positions.length,
    symbols,
    changedFrom,
  };
}
