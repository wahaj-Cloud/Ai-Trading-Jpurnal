import type { Exchange, Prisma } from "@atc/db";
import { canonicalSymbol, type OpenPositionSnapshot } from "@atc/exchange-adapters";

const MAX_LEVERAGE = 99_999_999;

/** Database rows for one account's live open positions, taken at `syncedAt`. */
export function openPositionRows(
  account: { id: string; userId: string; exchange: Exchange },
  snapshots: readonly OpenPositionSnapshot[],
  syncedAt: Date,
): Prisma.OpenPositionCreateManyInput[] {
  // An exchange listing the same position twice must not break the (account, externalId) key.
  const unique = new Map(snapshots.map((s) => [s.externalId, s]));
  return [...unique.values()].map((s) => {
    const { base, quote, settle } = canonicalSymbol(account.exchange, s.symbol);
    return {
      userId: account.userId,
      accountId: account.id,
      exchange: account.exchange,
      externalId: s.externalId,
      symbol: s.symbol,
      baseAsset: base,
      quoteAsset: quote,
      settleAsset: settle,
      direction: s.direction,
      quantity: s.quantity,
      lots: s.lots ?? null,
      entryPrice: s.entryPrice,
      markPrice: s.markPrice,
      unrealizedPnl: s.unrealizedPnl,
      leverage: s.leverage === null ? null : Math.min(Number(s.leverage), MAX_LEVERAGE).toFixed(2),
      liquidationPrice: s.liquidationPrice,
      marginMode: s.marginMode,
      openedAt: s.openedAt,
      syncedAt,
    };
  });
}
