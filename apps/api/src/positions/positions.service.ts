import { createHash } from "node:crypto";
import { addDays, startOfLocalDay, tradeRisk } from "@atc/analytics";
import { historyCutoff, userTimeZone } from "@atc/coach";
import type { Position, Prisma } from "@atc/db";
import { canonicalSymbol } from "@atc/exchange-adapters";
import {
  type EmotionCode,
  type FillDto,
  type ImportResult,
  type ImportRow,
  type JournalDto,
  MAX_STORED_CSV_TRADES,
  type MistakeCode,
  type PositionDto,
  type PositionsPage,
  type PositionsQuery,
  type TradeDetailDto,
} from "@atc/shared";
import { dec, str } from "@atc/trade-engine";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

type Meta = { ip: string | null; userAgent: string | null };
type PositionWithAccount = Position & { account: { label: string } | null };
type Review = { rating: number | null };
type JournalRow = Prisma.JournalEntryGetPayload<object>;

const SETUP_SUGGESTIONS = 20;

/** Closed trades older than the plan's history window are not shown (same rule as lists and analytics). */
export async function assertWithinHistory(
  db: Parameters<typeof historyCutoff>[0],
  userId: string,
  closedAt: Date | null,
): Promise<void> {
  if (!closedAt) return;
  const cutoff = await historyCutoff(db, userId);
  if (cutoff && closedAt < cutoff) {
    throw new ForbiddenException(
      "This trade is older than your plan's history window. Upgrade to see your full history.",
    );
  }
}

@Injectable()
export class PositionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Newest first, keyset-paginated on (time, id) so deep pages stay fast. The time is the opening
   * time, or with `sort=closed` the closing time (closed trades only).
   */
  async list(userId: string, q: PositionsQuery): Promise<PositionsPage> {
    const byClose = q.sort === "closed";
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const cutoff = await historyCutoff(this.prisma.client, userId);
    const and: Prisma.PositionWhereInput[] = [];
    // Plan history window: open trades always show; closed ones within the window.
    if (cutoff) and.push({ OR: [{ closedAt: null }, { closedAt: { gte: cutoff } }] });
    if (byClose) and.push({ closedAt: { not: null } });
    if (q.day) {
      // The same day boundaries as the calendar: the trader's own midnight to midnight.
      const tz = await userTimeZone(this.prisma.client, userId);
      and.push({
        closedAt: { gte: startOfLocalDay(q.day, tz), lt: startOfLocalDay(addDays(q.day, 1), tz) },
      });
    }
    if (cursor) {
      and.push(
        byClose
          ? {
              OR: [{ closedAt: { lt: cursor.at } }, { closedAt: cursor.at, id: { lt: cursor.id } }],
            }
          : {
              OR: [{ openedAt: { lt: cursor.at } }, { openedAt: cursor.at, id: { lt: cursor.id } }],
            },
      );
    }
    const where: Prisma.PositionWhereInput = {
      userId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.exchange ? { exchange: q.exchange } : {}),
      ...(q.symbol ? { symbol: q.symbol } : {}),
      ...(and.length ? { AND: and } : {}),
    };
    const rows = await this.prisma.client.position.findMany({
      where,
      orderBy: byClose
        ? [{ closedAt: "desc" }, { id: "desc" }]
        : [{ openedAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      include: { account: { select: { label: true } } },
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    const reviews = await this.reviewsFor(
      userId,
      page.map((p) => p.sourceKey),
    );
    const lastAt = last ? (byClose ? last.closedAt : last.openedAt) : null;
    return {
      items: page.map((p) => toDto(p, reviews.get(p.sourceKey))),
      nextCursor: rows.length > q.limit && last && lastAt ? encodeCursor(lastAt, last.id) : null,
    };
  }

  /** One trade with its executions, journal entry and risk figures. */
  async detail(userId: string, id: string): Promise<TradeDetailDto> {
    const position = await this.prisma.client.position.findFirst({
      where: { id, userId },
      include: {
        account: { select: { label: true } },
        fills: { include: { fill: true }, orderBy: { fill: { executedAt: "asc" } } },
      },
    });
    if (!position) throw new NotFoundException("Trade not found");
    await assertWithinHistory(this.prisma.client, userId, position.closedAt);
    const [journal, setups] = await Promise.all([
      this.prisma.client.journalEntry.findUnique({
        where: { userId_positionKey: { userId, positionKey: position.sourceKey } },
      }),
      this.prisma.client.journalEntry.groupBy({
        by: ["setup"],
        where: { userId, setup: { not: null } },
        _count: { setup: true },
        orderBy: { _count: { setup: "desc" } },
        take: SETUP_SUGGESTIONS,
      }),
    ]);
    const fills: FillDto[] = position.fills.map((pf) => ({
      id: pf.fill.id,
      side: pf.fill.side,
      role: pf.role,
      price: pf.fill.price.toString(),
      qty: pf.qty.toString(),
      // A flip fill is split between two trades: each shows its share of the fee.
      fee: pf.fill.qty.isZero()
        ? pf.fill.fee.toString()
        : str(dec(pf.fill.fee.toString()).times(pf.qty.toString()).div(pf.fill.qty.toString())),
      executedAt: pf.fill.executedAt.toISOString(),
    }));
    return {
      trade: toDto(position, journal ?? undefined),
      journal: journal ? journalDto(journal) : null,
      risk: tradeRisk({
        direction: position.direction,
        entryPrice: s(position.entryPrice),
        quantity: s(position.quantity),
        netPnl: s(position.netPnl),
        stopPrice: s(journal?.stopPrice ?? null),
        targetPrice: s(journal?.targetPrice ?? null),
        inverse: position.settleAsset !== position.quoteAsset,
      }),
      fills,
      setupSuggestions: setups.flatMap((g) => (g.setup ? [g.setup] : [])),
      // Added by the controller from the coach module.
      review: null,
      context: null,
      contextStatus: "NONE",
    };
  }

  private async reviewsFor(userId: string, keys: string[]): Promise<Map<string, Review>> {
    if (keys.length === 0) return new Map();
    const rows = await this.prisma.client.journalEntry.findMany({
      where: { userId, positionKey: { in: keys } },
      select: { positionKey: true, rating: true },
    });
    return new Map(rows.map((r) => [r.positionKey, { rating: r.rating }]));
  }

  /**
   * Imports closed trades from our CSV template. Re-importing the same row updates it (stable key).
   * Rows inside history already synced from a connected account of that exchange are skipped, so a
   * trade is never counted twice.
   */
  async importRows(userId: string, rows: ImportRow[], meta: Meta): Promise<ImportResult> {
    const accounts = await this.prisma.client.exchangeAccount.findMany({
      where: { userId, historyStartsAt: { not: null } },
      select: { exchange: true, historyStartsAt: true },
    });
    const syncedFrom = new Map<string, number>();
    for (const a of accounts) {
      const t = a.historyStartsAt?.getTime() ?? Number.POSITIVE_INFINITY;
      syncedFrom.set(
        a.exchange,
        Math.min(t, syncedFrom.get(a.exchange) ?? Number.POSITIVE_INFINITY),
      );
    }

    const toWrite = rows.filter(
      (r) =>
        new Date(r.closed_at).getTime() < (syncedFrom.get(r.exchange) ?? Number.POSITIVE_INFINITY),
    );
    const data = toWrite.map((r) => importedPosition(userId, r));
    const existing = await this.prisma.client.position.findMany({
      where: { userId, sourceKey: { in: data.map((d) => d.sourceKey) } },
      select: { sourceKey: true },
    });
    const existingKeys = new Set(existing.map((e) => e.sourceKey));
    const newRows = data.filter((d) => !existingKeys.has(d.sourceKey)).length;
    if (newRows > 0) {
      const stored = await this.prisma.client.position.count({ where: { userId, source: "CSV" } });
      if (stored + newRows > MAX_STORED_CSV_TRADES) {
        throw new ForbiddenException(
          `An account can hold up to ${MAX_STORED_CSV_TRADES.toLocaleString("en")} imported trades. Delete older imports or contact support.`,
        );
      }
    }

    await this.prisma.client.$transaction(
      data.map((d) =>
        this.prisma.client.position.upsert({
          where: { userId_sourceKey: { userId, sourceKey: d.sourceKey } },
          create: d,
          update: d,
        }),
      ),
    );

    const result: ImportResult = {
      imported: data.filter((d) => !existingKeys.has(d.sourceKey)).length,
      updated: data.filter((d) => existingKeys.has(d.sourceKey)).length,
      skippedAlreadySynced: rows.length - toWrite.length,
    };
    await this.audit.record({
      actorId: userId,
      action: "positions.imported",
      entity: "position",
      ...meta,
      metadata: { ...result },
    });
    return result;
  }
}

function importedPosition(userId: string, r: ImportRow): Prisma.PositionUncheckedCreateInput {
  const qty = dec(r.quantity);
  const move = dec(r.exit_price).minus(r.entry_price);
  const priceGross = (r.direction === "LONG" ? move : move.neg()).times(qty);
  const fees = dec(r.fees ?? "0");
  const funding = dec(r.funding ?? "0");
  // A user-supplied net is the ledger truth; gross then follows from it.
  const net = r.net_pnl !== undefined ? dec(r.net_pnl) : priceGross.minus(fees).plus(funding);
  const gross = r.net_pnl !== undefined ? net.plus(fees).minus(funding) : priceGross;
  const identity = [
    r.exchange,
    r.symbol,
    r.direction,
    r.opened_at,
    r.closed_at,
    r.entry_price,
    r.exit_price,
    r.quantity,
  ].join("|");
  const { base, quote, settle } = canonicalSymbol(r.exchange, r.symbol);
  const openedAt = new Date(r.opened_at);
  const closedAt = new Date(r.closed_at);
  return {
    userId,
    accountId: null,
    exchange: r.exchange,
    source: "CSV",
    sourceKey: `csv:${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`,
    symbol: `${base}${quote}`,
    baseAsset: base,
    quoteAsset: quote,
    settleAsset: settle,
    direction: r.direction,
    status: "CLOSED",
    openedAt,
    closedAt,
    entryPrice: r.entry_price,
    exitPrice: r.exit_price,
    quantity: r.quantity,
    leverage: r.leverage ?? null,
    grossPnl: str(gross),
    fees: str(fees),
    funding: str(funding),
    netPnl: str(net),
    holdingSeconds: Math.round((closedAt.getTime() - openedAt.getTime()) / 1000),
    incompleteHistory: false,
  };
}

const s = (v: Prisma.Decimal | null) => (v === null ? null : v.toString());

export function journalDto(j: JournalRow): JournalDto {
  return {
    setup: j.setup,
    tags: j.tags,
    emotions: j.emotions as EmotionCode[],
    mistakes: j.mistakes as MistakeCode[],
    rating: j.rating,
    notes: j.notes,
    stopPrice: s(j.stopPrice),
    targetPrice: s(j.targetPrice),
    screenshotUrls: j.screenshotUrls,
    updatedAt: j.updatedAt.toISOString(),
  };
}

export function toDto(p: PositionWithAccount, review?: Review): PositionDto {
  return {
    id: p.id,
    exchange: p.exchange,
    accountLabel: p.account?.label ?? null,
    source: p.source,
    symbol: p.symbol,
    baseAsset: p.baseAsset,
    quoteAsset: p.quoteAsset,
    settleAsset: p.settleAsset,
    sizeAsset: p.settleAsset === p.quoteAsset ? p.baseAsset : p.quoteAsset,
    direction: p.direction,
    status: p.status,
    openedAt: p.openedAt.toISOString(),
    closedAt: p.closedAt?.toISOString() ?? null,
    entryPrice: s(p.entryPrice),
    exitPrice: s(p.exitPrice),
    quantity: s(p.quantity),
    lots: s(p.lots),
    leverage: s(p.leverage),
    grossPnl: s(p.grossPnl),
    fees: s(p.fees),
    funding: s(p.funding),
    netPnl: s(p.netPnl),
    holdingSeconds: p.holdingSeconds,
    incompleteHistory: p.incompleteHistory,
    planned: p.setupAlertId !== null,
    btcCorrAtEntry: p.btcCorrAtEntry ?? null,
    reviewed: review !== undefined,
    rating: review?.rating ?? null,
  };
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const at = new Date(iso ?? "");
  if (!id || Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new BadRequestException("Invalid cursor");
  }
  return { at, id };
}
