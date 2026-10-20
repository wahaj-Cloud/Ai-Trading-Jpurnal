import type { Prisma, PrismaClient } from "@atc/db";
import {
  closePaperTrade,
  openPaperTrade,
  type PaperEntryNote,
  type PaperRules,
  type PaperSide,
} from "@atc/shared";

/**
 * Opening and closing paper trades (virtual money; nothing here talks to an exchange). Shared by
 * the worker (live checks, setup scanner) and the API (closing a trade by hand), so every fill is
 * booked the same way.
 */

type OpenTrade = {
  id: string;
  botId: string;
  side: PaperSide;
  entryPrice: number;
  qty: number;
  riskUsd: number;
  fees: number;
  funding: number;
};

const rulesOf = (b: PaperRules): PaperRules => ({
  stopRanges: b.stopRanges,
  targetR: b.targetR,
  maxHoldMin: b.maxHoldMin,
  riskPct: b.riskPct,
  feeBps: b.feeBps,
  slippageBps: b.slippageBps,
});

/**
 * Opens a trade for a bot, unless it already has one open. Sized on the bot's equity read inside
 * the same transaction, under a per-bot lock, so two checks can never open two trades.
 */
export async function enterPaperTrade(
  db: PrismaClient,
  botId: string,
  x: { side: PaperSide; price: number; range: number | null; at: number; note: PaperEntryNote },
): Promise<{ id: string } | null> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`paper:${botId}`}))`;
    const bot = await tx.paperBot.findUnique({ where: { id: botId } });
    if (!bot?.enabled) return null;
    const open = await tx.paperTrade.count({ where: { botId, status: "OPEN" } });
    if (open > 0) return null;
    const t = openPaperTrade({
      rules: rulesOf(bot),
      side: x.side,
      price: x.price,
      range: x.range,
      equity: bot.equity,
      at: x.at,
    });
    if (!t) return null;
    return tx.paperTrade.create({
      data: {
        botId,
        symbol: bot.symbol,
        side: t.side,
        entryAt: new Date(t.entryAt),
        entryPrice: t.entryPrice,
        stop: t.stop,
        target: t.target,
        qty: t.qty,
        riskUsd: t.riskUsd,
        fees: t.fees,
        fundedUntil: new Date(t.entryAt),
        entryNote: x.note as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  });
}

/**
 * Closes an open trade at a fill and books its profit to the bot. Only the first close counts
 * (a trade closed by the trader and by the engine at the same second is booked once).
 */
export async function settlePaperTrade(
  db: PrismaClient,
  t: OpenTrade,
  feeBps: number,
  exit: { exitPrice: number; reason: string; at: number; funding?: number },
): Promise<boolean> {
  const funding = exit.funding ?? t.funding;
  const c = closePaperTrade(
    { side: t.side, entryPrice: t.entryPrice, qty: t.qty, riskUsd: t.riskUsd, fees: t.fees },
    feeBps,
    exit.exitPrice,
    funding,
  );
  return db.$transaction(async (tx) => {
    const res = await tx.paperTrade.updateMany({
      where: { id: t.id, status: "OPEN" },
      data: {
        status: "CLOSED",
        exitAt: new Date(exit.at),
        exitPrice: c.exitPrice,
        exitReason: exit.reason,
        fees: c.fees,
        funding,
        pnl: c.pnl,
        rMultiple: c.rMultiple,
      },
    });
    if (res.count !== 1) return false;
    await tx.paperBot.update({ where: { id: t.botId }, data: { equity: { increment: c.pnl } } });
    return true;
  });
}
