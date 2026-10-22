import type { Prisma, PrismaClient } from "@atc/db";
import { snapshotsOf, writeSnapshot } from "@atc/db";
import { type AdapterConfig, fetchBinanceRecentCandles } from "@atc/exchange-adapters";
import {
  entryZoneOf,
  formatPrice,
  type NotificationKind,
  SCALP_KEY,
  type ScalpSnapshot,
  type StoredEntryZone,
  type StoredZone,
  UNLIMITED,
  ZONE_ALERT_DISCLAIMER,
  ZONE_HISTORY_DAYS,
  ZONE_STEP_MS,
  ZONE_TF_LABEL,
  ZONE_TFS,
  ZONES_KEY,
  type ZoneAlertSide,
  type ZoneSet,
  type ZonesSnapshot,
  type ZoneTf,
  zoneAlertHits,
} from "@atc/shared";
import { supplyDemandZones } from "@atc/ta";
import { log } from "../logger.js";

/**
 * Supply and demand zones on 1H and 4H for every scanned market, refreshed once each candle has
 * closed (a market is re-read only when a new candle of that timeframe is out), plus the alerts and
 * trade stamps that use them. Only closed candles count: a zone never comes from a moving candle.
 */

const STEP = ZONE_STEP_MS;
const CANDLES = 1000;
const CONCURRENCY = 3;
const M = 60_000;
const DAY = 86_400_000;
const NAMES: Record<string, string> = { XAUUSDT: "Gold", XAGUSDT: "Silver" };
const nameOf = (s: string) => NAMES[s] ?? s.replace(/USDT$/, "");

export interface ZoneScanDeps {
  db: PrismaClient;
  config: AdapterConfig;
  now?: () => number;
}

/** Reads the newest closed candles where a timeframe has a new one, and stores the zones. */
export async function runZoneScan(
  deps: ZoneScanDeps,
): Promise<{ refreshed: number; failed: number; markets: number }> {
  const now = (deps.now ?? Date.now)();
  const [scanRow, zonesRow] = await Promise.all([
    snapshotsOf(deps.db).get(SCALP_KEY),
    snapshotsOf(deps.db).get(ZONES_KEY),
  ]);
  const symbols = ((scanRow?.data as unknown as ScalpSnapshot | null)?.coins ?? []).map(
    (c) => c.symbol,
  );
  const prev = (zonesRow?.data as unknown as ZonesSnapshot | null)?.markets ?? {};
  const markets: ZonesSnapshot["markets"] = {};
  // Keep what is known for markets still scanned; markets that left the scan are dropped.
  for (const s of symbols) if (prev[s]) markets[s] = { ...prev[s] };

  const jobs: Array<{ symbol: string; tf: ZoneTf; closeAt: number }> = [];
  for (const symbol of symbols)
    for (const tf of ZONE_TFS) {
      // Close time of the newest candle that has closed.
      const closeAt = Math.floor(now / STEP[tf]) * STEP[tf];
      const have = markets[symbol]?.[tf]?.asOf;
      if (!have || Date.parse(have) < closeAt) jobs.push({ symbol, tf, closeAt });
    }

  let refreshed = 0;
  let failed = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      for (;;) {
        const job = jobs[next++];
        if (!job) return;
        try {
          const candles = await fetchBinanceRecentCandles(
            deps.config.binance ?? {},
            job.symbol,
            job.tf,
            CANDLES,
            now,
          );
          const last = candles.at(-1);
          // The exchange has not published the closed candle yet: next minute.
          if (!last || last.t + STEP[job.tf] < job.closeAt) continue;
          const set: ZoneSet = {
            asOf: new Date(last.t + STEP[job.tf]).toISOString(),
            zones: supplyDemandZones(candles).map((z) => ({
              side: z.side,
              top: z.top,
              bottom: z.bottom,
              t: z.t,
              tests: z.tests,
            })),
          };
          markets[job.symbol] = { ...markets[job.symbol], [job.tf]: set };
          await deps.db.zoneHistory.upsert({
            select: { symbol: true },
            where: {
              symbol_tf_at: { symbol: job.symbol, tf: job.tf, at: new Date(set.asOf) },
            },
            create: {
              symbol: job.symbol,
              tf: job.tf,
              at: new Date(set.asOf),
              zones: set.zones as unknown as Prisma.InputJsonValue,
            },
            update: { zones: set.zones as unknown as Prisma.InputJsonValue },
          });
          refreshed++;
        } catch (err) {
          failed++;
          log.warn("zone scan failed", { symbol: job.symbol, tf: job.tf, err });
        }
      }
    }),
  );

  if (refreshed > 0 || symbols.length !== Object.keys(prev).length) {
    const data: ZonesSnapshot = { computedAt: new Date(now).toISOString(), markets };
    const json = data as unknown as Prisma.InputJsonValue;
    await writeSnapshot(deps.db, ZONES_KEY, json, new Date(now));
  }
  if (new Date(now).getUTCMinutes() === 30)
    await deps.db.zoneHistory.deleteMany({
      where: { at: { lt: new Date(now - ZONE_HISTORY_DAYS * DAY) } },
    });
  return { refreshed, failed, markets: Object.keys(markets).length };
}

// ─── Alerts ───

export interface ZoneAlertDeps {
  db: PrismaClient;
  notify: (n: {
    userId: string;
    kind: NotificationKind;
    title: string;
    body: string;
    link?: string | null;
    dedupeKey: string;
    allowEmail?: boolean;
  }) => Promise<unknown>;
  /** Plan limits per user (cached by the caller). */
  limits: (
    userId: string,
    now: number,
  ) => Promise<{
    marketPulseCoins: number;
    setupAlertEmail: number;
  }>;
  now?: () => number;
}

type AlertRow = Awaited<ReturnType<PrismaClient["zoneAlert"]["findMany"]>>[number];

/**
 * Zone alerts: fire when the price arrives inside a watched zone, i.e. it is inside now and was
 * not at the previous check. The same zone stays quiet for the alert's rest time. Checked every
 * second on the live price (or every minute on the scan's price while the live feed is down).
 */
export class ZoneAlerts {
  private busy = false;
  private alerts: { at: number; rows: AlertRow[] } | null = null;
  private zones: { at: number; data: ZonesSnapshot | null } | null = null;
  /** Per alert, the zones the price was inside at the last check. */
  private readonly inside = new Map<string, Set<string>>();

  constructor(private readonly deps: ZoneAlertDeps) {}

  /** `markets`: symbol → price and rank (the plan's top coins; gold and silver always). */
  async check(markets: Map<string, { price: number; rank: number }>): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const now = (this.deps.now ?? Date.now)();
      const db = this.deps.db;
      if (!this.alerts || now - this.alerts.at >= 10_000)
        this.alerts = { at: now, rows: await db.zoneAlert.findMany({ where: { enabled: true } }) };
      if (this.alerts.rows.length === 0) return 0;
      if (!this.zones || now - this.zones.at >= 30_000) {
        const row = await snapshotsOf(db).get(ZONES_KEY);
        this.zones = { at: now, data: (row?.data as unknown as ZonesSnapshot) ?? null };
      }
      const data = this.zones.data;
      if (!data) return 0;
      let sent = 0;
      for (const a of this.alerts.rows) {
        try {
          const m = markets.get(a.symbol);
          if (!m) continue;
          const limits = await this.deps.limits(a.userId, now);
          if (
            limits.marketPulseCoins !== UNLIMITED &&
            m.rank > limits.marketPulseCoins &&
            a.symbol !== "XAUUSDT" &&
            a.symbol !== "XAGUSDT"
          )
            continue;
          const hits = zoneAlertHits(
            { tfs: a.tfs, side: a.side as ZoneAlertSide, freshOnly: a.freshOnly },
            data.markets[a.symbol],
            m.price,
          );
          const keys = new Set(hits.map((h) => h.key));
          // The first check after a start only learns where the price is (no alert for being
          // already inside); afterwards a zone counts when it was not entered at the last check.
          const before = this.inside.get(a.id);
          this.inside.set(a.id, keys);
          if (!before) continue;
          const arrived = hits.filter((h) => !before.has(h.key));
          const hit = arrived.find(
            (h) =>
              h.key !== a.lastZoneKey ||
              !a.lastFiredAt ||
              now - a.lastFiredAt.getTime() >= a.cooldownMin * M,
          );
          if (!hit) continue;
          const z = hit.zone;
          const kind = `${z.tests === 0 ? "fresh " : ""}${ZONE_TF_LABEL[hit.tf]} ${z.side}`;
          const also = hits.filter((h) => h.key !== hit.key);
          await this.deps.notify({
            userId: a.userId,
            kind: "ZONE_ALERT",
            title: `${nameOf(a.symbol)} reached a ${kind} zone`,
            body: [
              `Price ${formatPrice(m.price)} is inside ${formatPrice(z.bottom)}–${formatPrice(z.top)} (${ZONE_TF_LABEL[hit.tf]} ${z.side}, ${z.tests === 0 ? "first return" : `returned ${z.tests}× before`}).`,
              also.length
                ? `Also inside: ${also.map((h) => `${ZONE_TF_LABEL[h.tf]} ${h.zone.side}`).join(", ")}.`
                : "",
              z.side === "demand"
                ? "Demand zones mark where buyers last took over."
                : "Supply zones mark where sellers last took over.",
              ZONE_ALERT_DISCLAIMER,
            ]
              .filter(Boolean)
              .join(" "),
            link: `/cockpit?s=${a.symbol}&tf=5m#levels`,
            dedupeKey: `zone:${a.id}:${hit.key}:${Math.floor(now / M)}`,
            allowEmail: limits.setupAlertEmail === 1,
          });
          await db.zoneAlert.update({
            where: { id: a.id },
            data: { lastZoneKey: hit.key, lastFiredAt: new Date(now) },
          });
          a.lastZoneKey = hit.key;
          a.lastFiredAt = new Date(now);
          sent++;
        } catch (err) {
          log.warn("zone alert check failed", { alertId: a.id, err });
        }
      }
      return sent;
    } finally {
      this.busy = false;
    }
  }
}

// ─── Trades entered at a zone ───

/**
 * Stamps recent trades with the 1H and 4H zones their entry price was inside, from the zone
 * records in force when they opened (the newest record at or before the entry, no older than two
 * candles). A trade with no record on either timeframe is marked once it is three hours old.
 */
export async function stampEntryZones(db: PrismaClient, now = Date.now()): Promise<number> {
  const trades = await db.$queryRaw<
    Array<{ id: string; baseAsset: string; openedAt: Date; entryPrice: unknown }>
  >`
    SELECT id, base_asset AS "baseAsset", opened_at AS "openedAt", entry_price AS "entryPrice"
      FROM positions
     WHERE entry_zone IS NULL AND entry_price IS NOT NULL
       AND opened_at >= ${new Date(now - ZONE_HISTORY_DAYS * DAY + 10 * M)}
       AND opened_at <= ${new Date(now - M)}
     ORDER BY opened_at DESC LIMIT 500`;
  let stamped = 0;
  for (const t of trades) {
    const price = Number(t.entryPrice);
    if (!(price > 0)) continue;
    const base = t.baseAsset.toUpperCase().replace(/^1000(?=[A-Z])/, "");
    const records: Partial<Record<ZoneTf, { at: Date; zones: StoredZone[] }>> = {};
    for (const tf of ZONE_TFS) {
      const row = await db.zoneHistory.findFirst({
        where: {
          symbol: { in: [`${base}USDT`, `1000${base}USDT`] },
          tf,
          at: { lte: t.openedAt, gt: new Date(t.openedAt.getTime() - 2 * STEP[tf]) },
        },
        orderBy: { at: "desc" },
      });
      if (row) records[tf] = { at: row.at, zones: row.zones as unknown as StoredZone[] };
    }
    const hit = entryZoneOf(price, records);
    let value: StoredEntryZone | null = hit;
    if (!hit) {
      if (now - t.openedAt.getTime() < 3 * 3_600_000) continue; // may still be recorded
      value = { none: true };
    }
    await db.position.update({
      where: { id: t.id },
      data: { entryZone: value as unknown as Prisma.InputJsonValue },
    });
    stamped++;
  }
  return stamped;
}
