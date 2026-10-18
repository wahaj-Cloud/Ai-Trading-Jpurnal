import type { Prisma } from "@atc/db";
import { type OpenPositionDto, type OpenPositionsDto, USD_SETTLEMENT_ASSETS } from "@atc/shared";
import { dec, str, ZERO } from "@atc/trade-engine";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

const USD = new Set<string>(USD_SETTLEMENT_ASSETS);
const s = (v: Prisma.Decimal | null) => (v === null ? null : v.toString());

type Row = Prisma.OpenPositionGetPayload<{ include: { account: { select: { label: true } } } }>;

@Injectable()
export class OpenPositionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Live positions from active accounts, largest exposure first. */
  async list(userId: string): Promise<OpenPositionsDto> {
    const rows = await this.prisma.client.openPosition.findMany({
      where: { userId, account: { status: "ACTIVE" } },
      include: { account: { select: { label: true } } },
      orderBy: [{ symbol: "asc" }, { id: "asc" }],
    });
    const items = rows.map(toDto).sort((a, b) => notionalOf(b) - notionalOf(a));
    let unrealized = ZERO;
    for (const p of items) {
      if (p.unrealizedPnl && USD.has(p.settleAsset)) unrealized = unrealized.plus(p.unrealizedPnl);
    }
    const asOf = rows.reduce<Date | null>(
      (min, r) => (min === null || r.syncedAt < min ? r.syncedAt : min),
      null,
    );
    return { items, unrealizedPnl: str(unrealized), asOf: asOf?.toISOString() ?? null };
  }
}

const notionalOf = (p: OpenPositionDto) => (p.notional ? Number(p.notional) : 0);

function toDto(r: Row): OpenPositionDto {
  const inverse = r.settleAsset !== r.quoteAsset;
  const mark = r.markPrice;
  const liq = r.liquidationPrice;
  let liquidationDistance: number | null = null;
  if (mark && liq && mark.gt(0)) {
    const move = r.direction === "LONG" ? mark.minus(liq) : liq.minus(mark);
    liquidationDistance = Math.max(0, move.div(mark).toDecimalPlaces(4).toNumber());
  }
  return {
    id: r.id,
    accountId: r.accountId,
    accountLabel: r.account.label,
    exchange: r.exchange,
    symbol: r.symbol,
    baseAsset: r.baseAsset,
    quoteAsset: r.quoteAsset,
    settleAsset: r.settleAsset,
    sizeAsset: inverse ? r.quoteAsset : r.baseAsset,
    direction: r.direction,
    quantity: s(r.quantity),
    lots: s(r.lots),
    entryPrice: s(r.entryPrice),
    markPrice: s(mark),
    unrealizedPnl: s(r.unrealizedPnl),
    notional: !r.quantity
      ? null
      : inverse
        ? str(dec(r.quantity.toString()))
        : mark
          ? str(dec(r.quantity.toString()).times(mark.toString()).toDecimalPlaces(2))
          : null,
    leverage: s(r.leverage),
    liquidationPrice: s(liq),
    liquidationDistance,
    marginMode: r.marginMode,
    openedAt: r.openedAt?.toISOString() ?? null,
    syncedAt: r.syncedAt.toISOString(),
  };
}
