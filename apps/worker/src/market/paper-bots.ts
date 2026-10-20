import { enterPaperTrade, settlePaperTrade } from "@atc/coach";
import type { PrismaClient } from "@atc/db";
import {
  type CockpitTf,
  fundingCost,
  fundingTimesBetween,
  type LiveTick,
  paperExit,
  scalpAlertMet,
} from "@atc/shared";
import { log } from "../logger.js";
import { LiveBase, planCovers, readout } from "./scalp-readouts.js";

/**
 * Paper bots: rules run with virtual money on live prices. Nothing here talks to an exchange
 * account; a bot never sends an order. Open trades are checked every second on the live price
 * (stop, target, longest hold) and pay funding at 00:00, 08:00 and 16:00 UTC; Cockpit bots enter
 * the second their count of readings starts holding; setup bots enter at the close of the candle
 * their saved setup matched on (see the setup scanner).
 */

export interface PaperDeps {
  db: PrismaClient;
  now?: () => number;
}

type BotRow = Awaited<ReturnType<PrismaClient["paperBot"]["findMany"]>>[number];
type OpenRow = Awaited<ReturnType<PrismaClient["paperTrade"]["findMany"]>>[number] & {
  bot: Pick<BotRow, "feeBps" | "slippageBps" | "maxHoldMin">;
};

export class PaperBotEngine {
  private busy = false;
  private bots: { at: number; rows: BotRow[] } | null = null;
  private open: { at: number; rows: Map<string, OpenRow> } | null = null;
  private readonly base: LiveBase;

  constructor(
    private readonly deps: PaperDeps,
    base?: LiveBase,
  ) {
    this.base = base ?? new LiveBase(deps.db);
  }

  /** Called with every live tick. Returns what happened, for logs and tests. */
  async onTick(tick: LiveTick): Promise<{ opened: number; closed: number }> {
    if (this.busy) return { opened: 0, closed: 0 };
    this.busy = true;
    try {
      const now = (this.deps.now ?? Date.now)();
      const db = this.deps.db;
      if (!this.open || now - this.open.at >= 10_000) {
        const rows = (await db.paperTrade.findMany({
          where: { status: "OPEN" },
          include: { bot: { select: { feeBps: true, slippageBps: true, maxHoldMin: true } } },
        })) as OpenRow[];
        this.open = { at: now, rows: new Map(rows.map((r) => [r.botId, r])) };
      }
      if (!this.bots || now - this.bots.at >= 10_000)
        this.bots = {
          at: now,
          rows: await db.paperBot.findMany({
            where: {
              enabled: true,
              source: "COCKPIT",
              user: { deletedAt: null, suspendedAt: null },
            },
          }),
        };
      const live = new Map(tick.coins.map((c) => [c.s, c]));
      const closed = await this.manage(live, now);
      const opened = await this.enterCockpitBots(tick, now);
      return { opened, closed };
    } finally {
      this.busy = false;
    }
  }

  /** Funding, then stop, target and time on every open trade. */
  private async manage(live: Map<string, LiveTick["coins"][number]>, now: number) {
    let closed = 0;
    const open = this.open?.rows ?? new Map<string, OpenRow>();
    for (const [botId, t] of open) {
      try {
        const c = live.get(t.symbol);
        if (!c || !(c.p > 0)) continue;
        const from = (t.fundedUntil ?? t.entryAt).getTime();
        const due = fundingTimesBetween(from, now);
        if (due.length > 0) {
          const cost = due.reduce((s) => s + fundingCost(t.side, t.qty, c.p, c.f ?? 0), 0);
          const until = new Date(due.at(-1) as number);
          await this.deps.db.paperTrade.updateMany({
            where: { id: t.id, status: "OPEN" },
            data: { funding: { increment: cost }, fundedUntil: until },
          });
          t.funding += cost;
          t.fundedUntil = until;
        }
        const exit = paperExit(
          {
            side: t.side,
            entryAt: t.entryAt.getTime(),
            stop: t.stop,
            target: t.target,
          },
          t.bot,
          c.p,
          now,
        );
        if (!exit) continue;
        await settlePaperTrade(this.deps.db, t, t.bot.feeBps, { ...exit, at: now });
        open.delete(botId);
        closed++;
      } catch (err) {
        log.warn("paper trade check failed", { tradeId: t.id, err });
      }
    }
    return closed;
  }

  /** Cockpit bots enter when their count of readings starts holding (same rules as alerts). */
  private async enterCockpitBots(tick: LiveTick, now: number) {
    const bots = this.bots?.rows ?? [];
    if (bots.length === 0) return 0;
    const { inputs, snap } = await this.base.refresh(now);
    const coins = this.base.coins(snap, tick, new Set(bots.map((b) => b.symbol)));
    const computedAt = new Date(tick.at).toISOString();
    let opened = 0;
    for (const b of bots) {
      try {
        const coin = coins.get(b.symbol);
        if (!coin) continue;
        const limits = await this.base.limits(b.userId, now);
        if (!planCovers(limits, coin)) continue;
        const tf = b.tf as CockpitTf;
        const r = readout(coin, tf, inputs, computedAt, now, limits.marketDesk === 1);
        const met = scalpAlertMet(
          {
            direction: b.direction as "ANY" | "UP" | "DOWN",
            minCount: b.minCount,
            noNews: b.noNews,
          },
          r,
        );
        const starts = met !== null && !b.lastMet;
        if (starts && !this.open?.rows.has(b.id)) {
          const row = await enterPaperTrade(this.deps.db, b.id, {
            side: met === "up" ? "LONG" : "SHORT",
            price: coin.price,
            range: tf === "5m" ? coin.volatility.atr5m : coin.volatility.atr15m,
            at: now,
            note: {
              kind: "cockpit",
              up: r.tally.up,
              down: r.tally.down,
              total: r.tally.up + r.tally.down + r.tally.neutral,
            },
          });
          if (row) {
            opened++;
            // Picked up with its bot's rules at the next reload; until then, read it now.
            const full = (await this.deps.db.paperTrade.findUnique({
              where: { id: row.id },
              include: { bot: { select: { feeBps: true, slippageBps: true, maxHoldMin: true } } },
            })) as OpenRow | null;
            if (full) this.open?.rows.set(b.id, full);
          }
        }
        if (b.lastMet !== (met !== null)) {
          await this.deps.db.paperBot.updateMany({
            where: { id: b.id },
            data: { lastMet: met !== null },
          });
          b.lastMet = met !== null;
        }
      } catch (err) {
        log.warn("paper bot check failed", { botId: b.id, err });
      }
    }
    return opened;
  }
}
