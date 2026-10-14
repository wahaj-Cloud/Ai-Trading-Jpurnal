import { isValidTimeZone, localParts, startOfLocalDay } from "@atc/analytics";
import { planLimits } from "@atc/coach";
import type { PrismaClient } from "@atc/db";
import { type AdapterConfig, fetchBinanceRecentCandles } from "@atc/exchange-adapters";
import { type NewNotification, notify } from "@atc/notify";
import {
  SETUP_ALERT_DISCLAIMER,
  SETUP_WINDOW,
  type SetupExchange,
  type SetupRule,
  type SetupTimeframe,
  setupRuleSchema,
} from "@atc/shared";
import { evaluateSetupAt, SETUP_MIN_CANDLES, TIMEFRAME_MS } from "@atc/ta";
import type { Redis } from "ioredis";
import { log } from "../logger.js";
import { saveCandles } from "../market/candle-store.js";

/**
 * My Setup Alerts scanner (runs every minute). Active setups are grouped by exchange, symbol and
 * timeframe; one public candle request per group serves every user watching it. Each candle is
 * checked once, after it closes, never while it is still moving.
 */

export interface ScanDeps {
  db: PrismaClient;
  redis: Pick<Redis, "get" | "set">;
  config: AdapterConfig;
  notify: (n: NewNotification) => ReturnType<typeof notify>;
  now?: () => number;
}

interface ActiveSetup {
  id: string;
  userId: string;
  name: string;
  timeframe: SetupTimeframe;
  rule: SetupRule;
  cooldownMinutes: number;
}

const GROUP_CONCURRENCY = 4;
/** After downtime, only a candle that closed this recently still alerts (older news is noise). */
const STALE_CANDLES = 2;

export async function scanSetups(deps: ScanDeps): Promise<{ groups: number; alerts: number }> {
  const now = (deps.now ?? Date.now)();
  const setups = await deps.db.setup.findMany({
    where: { isActive: true, deletedAt: null, user: { deletedAt: null, suspendedAt: null } },
    select: {
      id: true,
      userId: true,
      name: true,
      exchange: true,
      symbols: true,
      timeframe: true,
      rule: true,
      cooldownMinutes: true,
    },
  });
  const groups = new Map<
    string,
    { exchange: SetupExchange; symbol: string; tf: SetupTimeframe; setups: ActiveSetup[] }
  >();
  for (const s of setups) {
    const rule = setupRuleSchema.safeParse(s.rule);
    if (!rule.success || s.exchange !== "BINANCE") continue;
    const tf = s.timeframe as SetupTimeframe;
    if (!TIMEFRAME_MS[tf]) continue;
    for (const symbol of s.symbols) {
      const key = `${s.exchange}:${symbol}:${tf}`;
      const g = groups.get(key) ?? { exchange: "BINANCE", symbol, tf, setups: [] };
      g.setups.push({
        id: s.id,
        userId: s.userId,
        name: s.name,
        timeframe: tf,
        rule: rule.data,
        cooldownMinutes: s.cooldownMinutes,
      });
      groups.set(key, g);
    }
  }

  const list = [...groups.values()];
  const sent: number[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(GROUP_CONCURRENCY, list.length) }, async () => {
      for (;;) {
        const g = list[next++];
        if (!g) return;
        try {
          sent.push(await scanGroup(deps, g, now));
        } catch (err) {
          log.warn("setup scan group failed", { symbol: g.symbol, tf: g.tf, err });
        }
      }
    }),
  );
  const alerts = sent.reduce((a, b) => a + b, 0);
  return { groups: list.length, alerts };
}

async function scanGroup(
  deps: ScanDeps,
  g: { exchange: SetupExchange; symbol: string; tf: SetupTimeframe; setups: ActiveSetup[] },
  now: number,
): Promise<number> {
  const step = TIMEFRAME_MS[g.tf];
  const lastClosed = Math.floor(now / step) * step - step;
  const key = `setupscan:${g.exchange}:${g.symbol}:${g.tf}`;
  if (Number(await deps.redis.get(key)) >= lastClosed) return 0;

  const candles = await fetchBinanceRecentCandles(
    deps.config.binance ?? {},
    g.symbol,
    g.tf,
    SETUP_WINDOW,
    now,
  );
  const last = candles.at(-1);
  // The exchange has not published the closed candle yet: try again next minute.
  if (!last || last.t < lastClosed || candles.length < SETUP_MIN_CANDLES) return 0;
  // Keep the shared store current (later backtests reuse these candles).
  await saveCandles(deps.db, g.exchange, g.symbol, g.tf, candles.slice(-3));
  await deps.redis.set(key, String(last.t), "EX", 7 * 86_400);
  if (now - (last.t + step) > STALE_CANDLES * step) return 0;

  const i = candles.length - 1;
  const closeAt = new Date(last.t + step);
  let sent = 0;
  for (const s of g.setups) {
    const match = evaluateSetupAt(s.rule, candles, i);
    if (!match.matched) continue;
    if (s.cooldownMinutes > 0) {
      const recent = await deps.db.setupAlert.findFirst({
        where: {
          setupId: s.id,
          symbol: g.symbol,
          candleCloseAt: { gt: new Date(closeAt.getTime() - s.cooldownMinutes * 60_000) },
        },
        select: { id: true },
      });
      if (recent) continue;
    }
    const limits = await planLimits(deps.db, s.userId);
    const allowEmail = limits.setupAlertEmail === 1;
    let alertId: string;
    try {
      const row = await deps.db.setupAlert.create({
        data: {
          setupId: s.id,
          userId: s.userId,
          symbol: g.symbol,
          timeframe: g.tf,
          direction: s.rule.direction,
          candleCloseAt: closeAt,
          matched: match.labels,
          channels: allowEmail ? ["in_app", "email"] : ["in_app"],
        },
        select: { id: true },
      });
      alertId = row.id;
    } catch (err) {
      // Another scanner already alerted on this candle.
      if ((err as { code?: string }).code === "P2002") continue;
      throw err;
    }
    const tradesLeft = await tradesLeftToday(deps.db, s.userId, now);
    await deps.notify({
      userId: s.userId,
      kind: "SETUP_ALERT",
      title: `Your "${s.name}" is forming on ${g.symbol} ${g.tf}`,
      body: [`${match.labels.join(" · ")}.`, tradesLeft, SETUP_ALERT_DISCLAIMER]
        .filter(Boolean)
        .join(" "),
      link: `/setups?alert=${alertId}`,
      dedupeKey: `setup:${alertId}`,
      allowEmail,
    });
    sent += 1;
  }
  return sent;
}

/** "You have 1 of 3 trades left today." when the trader set a daily trade limit. */
async function tradesLeftToday(
  db: PrismaClient,
  userId: string,
  now: number,
): Promise<string | null> {
  const [limit, user] = await Promise.all([
    db.riskLimit.findUnique({ where: { userId }, select: { maxTradesPerDay: true } }),
    db.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
  ]);
  const max = limit?.maxTradesPerDay;
  if (!max) return null;
  const tz = user?.timezone && isValidTimeZone(user.timezone) ? user.timezone : "UTC";
  const start = startOfLocalDay(localParts(new Date(now), tz).date, tz);
  const taken = await db.position.count({ where: { userId, openedAt: { gte: start } } });
  const left = Math.max(0, max - taken);
  return left === 0
    ? `You have used all ${max} of today's trades.`
    : `You have ${left} of ${max} trades left today.`;
}

/**
 * Links freshly synced trades to the alert they followed: same coin and direction, opened within a
 * few candles after the alert. Gives the journal and coach "planned" vs "no setup".
 */
export async function matchAlertsToTrades(db: PrismaClient, userId: string): Promise<number> {
  return db.$executeRaw`
    WITH m AS (
      SELECT p.id AS position_id, a.id AS alert_id
      FROM positions p
      JOIN LATERAL (
        SELECT a.id FROM setup_alerts a
        WHERE a.user_id = p.user_id
          AND a.symbol = p.symbol
          AND upper(a.direction) = p.direction::text
          AND p.opened_at >= a.candle_close_at
          AND p.opened_at <= a.candle_close_at + CASE a.timeframe
            WHEN '5m' THEN interval '20 minutes'
            WHEN '15m' THEN interval '1 hour'
            WHEN '1h' THEN interval '4 hours'
            ELSE interval '16 hours' END
        ORDER BY a.candle_close_at DESC, a.id ASC
        LIMIT 1
      ) a ON true
      WHERE p.user_id = ${userId}::uuid
        AND p.setup_alert_id IS NULL
        AND p.opened_at > now() - interval '14 days'
    )
    UPDATE positions SET setup_alert_id = m.alert_id FROM m WHERE positions.id = m.position_id`;
}
