import { planLimits } from "@atc/coach";
import type { Prisma, PrismaClient } from "@atc/db";
import {
  applyLiveToScalpCoin,
  type BiasState,
  buildScalpReadout,
  type CockpitDto,
  type CockpitTf,
  DESK_SYMBOLS,
  deskKey,
  entryFromRecord,
  FLOW_FREE_SYMBOLS,
  FLOW_SYMBOLS,
  formatPrice,
  type LiveTick,
  type MarketDeskDto,
  type NotificationKind,
  planLine,
  planToQuery,
  READOUT_KEEP_DAYS,
  type ReadoutInput,
  type ReadoutRecord,
  SCALP_ALERT_DISCLAIMER,
  SCALP_KEY,
  type ScalpCoinDto,
  type ScalpEventDto,
  type ScalpSnapshot,
  STRENGTH_LABEL,
  type StoredEntryReadout,
  scalpAlertMet,
  UNLIMITED,
} from "@atc/shared";
import { log } from "../logger.js";

const M = 60_000;
const DAY = 86_400_000;
const NAMES: Record<string, string> = { XAUUSDT: "Gold", XAGUSDT: "Silver" };
const nameOf = (s: string) => NAMES[s] ?? s.replace(/USDT$/, "");

export interface ScalpReadoutDeps {
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
  now?: () => number;
}

type Flow = { whales: CockpitDto["whales"]; liquidations: CockpitDto["liquidations"] };
export interface Inputs {
  events: ScalpEventDto[];
  hotHeadlines: number;
  /** Per symbol and timeframe, whale orders and liquidations (Market Flow markets). */
  flow: Map<string, Record<CockpitTf, Flow>>;
  bias1h: Map<string, BiasState>;
}

/** Everything the readings need besides the scan: news, Market Flow and trend. */
export async function loadInputs(db: PrismaClient, now: number): Promise<Inputs> {
  const [events, hot, rows, desks] = await Promise.all([
    db.economicEvent.findMany({
      where: {
        impact: "HIGH",
        currency: { in: ["USD", "ALL"] },
        startsAt: { gte: new Date(now - 15 * M), lte: new Date(now + 4 * 3_600_000) },
      },
      orderBy: { startsAt: "asc" },
      take: 5,
      select: { title: true, currency: true, startsAt: true },
    }),
    // One count per story.
    db.newsItem.findMany({
      where: { impact: "HIGH", publishedAt: { gte: new Date(now - 30 * M), lte: new Date(now) } },
      select: { clusterId: true, title: true },
    }),
    db.$queryRaw<
      Array<{ kind: string; symbol: string; side: string; w: number; usd: unknown; n: bigint }>
    >`
      SELECT 'whale' AS kind, symbol, side, CASE WHEN at >= ${new Date(now - 5 * M)} THEN 5 ELSE 15 END AS w,
             SUM(usd) AS usd, COUNT(*) AS n
        FROM whale_trades WHERE at >= ${new Date(now - 15 * M)} AND at <= ${new Date(now)} GROUP BY 1, 2, 3, 4
      UNION ALL
      SELECT 'liq', symbol, side, CASE WHEN at >= ${new Date(now - 5 * M)} THEN 5 ELSE 15 END,
             SUM(usd), COUNT(*)
        FROM liquidation_events WHERE at >= ${new Date(now - 15 * M)} AND at <= ${new Date(now)} GROUP BY 1, 2, 3, 4`,
    db.marketSnapshot.findMany({ where: { key: { in: DESK_SYMBOLS.map(deskKey) } } }),
  ]);
  const flow = new Map<string, Record<CockpitTf, Flow>>();
  for (const s of FLOW_SYMBOLS) {
    const empty = (): Flow => ({
      whales: { buyUsd: 0, sellUsd: 0, buys: 0, sells: 0 },
      liquidations: { longUsd: 0, shortUsd: 0 },
    });
    flow.set(s, { "5m": empty(), "15m": empty() });
  }
  for (const r of rows) {
    const f = flow.get(r.symbol);
    if (!f) continue;
    const usd = Number(r.usd);
    const n = Number(r.n);
    // Rows of the last 5 minutes count for both windows; older ones for 15m only.
    const targets: CockpitTf[] = Number(r.w) === 5 ? ["5m", "15m"] : ["15m"];
    for (const tf of targets) {
      const t = f[tf];
      if (r.kind === "whale" && t.whales) {
        if (r.side === "buy") {
          t.whales.buyUsd += usd;
          t.whales.buys += n;
        } else if (r.side === "sell") {
          t.whales.sellUsd += usd;
          t.whales.sells += n;
        }
      } else if (r.kind === "liq" && t.liquidations) {
        if (r.side === "long") t.liquidations.longUsd += usd;
        else if (r.side === "short") t.liquidations.shortUsd += usd;
      }
    }
  }
  const bias1h = new Map<string, BiasState>();
  for (const d of desks) {
    const desk = d.data as unknown as MarketDeskDto;
    if (!desk?.computedAt || now - Date.parse(desk.computedAt) > 2 * 3_600_000) continue;
    const b = desk.bias?.find((x) => x.timeframe === "1h");
    if (b) bias1h.set(d.key.replace(/^desk:/, ""), b.state);
  }
  return {
    events: events.map((e) => ({
      title: e.title,
      currency: e.currency,
      startsAt: e.startsAt.toISOString(),
    })),
    hotHeadlines: new Set(hot.map((h) => h.clusterId ?? h.title)).size,
    flow,
    bias1h,
  };
}

/** Readings of one market as a given plan sees them (Free: flow on BTC/ETH, trend on BTC). */
export function readout(
  coin: ScalpCoinDto,
  tf: CockpitTf,
  inputs: Inputs,
  computedAt: string,
  now: number,
  full: boolean,
) {
  const flowAllowed = full || (FLOW_FREE_SYMBOLS as readonly string[]).includes(coin.symbol);
  const biasAllowed = full || coin.symbol === "BTCUSDT";
  const f = flowAllowed ? inputs.flow.get(coin.symbol)?.[tf] : undefined;
  const input: ReadoutInput = {
    tf,
    coin,
    now,
    computedAt,
    events: inputs.events,
    hotHeadlines: inputs.hotHeadlines,
    whales: f?.whales ?? null,
    liquidations: f?.liquidations ?? null,
    bias1h: biasAllowed ? (inputs.bias1h.get(coin.symbol) ?? null) : null,
  };
  return buildScalpReadout(input);
}

/**
 * After every 1-minute scan: each market's Cockpit counts are recorded (for trade entries and the
 * threshold review) and every enabled scalp alert is checked.
 */
export async function runScalpReadouts(
  deps: ScalpReadoutDeps,
  scalp: ScalpSnapshot,
  /** False while the live engine checks alerts every second (so the two never disagree). */
  opts: { alerts?: boolean } = {},
): Promise<{ recorded: number; alerts: number }> {
  const now = (deps.now ?? Date.now)();
  const inputs = await loadInputs(deps.db, now);
  const full = new Map<string, Record<CockpitTf, ReturnType<typeof readout>>>();
  const data: Record<string, ReadoutRecord> = {};
  for (const c of scalp.coins) {
    const r5 = readout(c, "5m", inputs, scalp.computedAt, now, true);
    const r15 = readout(c, "15m", inputs, scalp.computedAt, now, true);
    full.set(c.symbol, { "5m": r5, "15m": r15 });
    const t = (r: typeof r5) => r.tally.up + r.tally.down + r.tally.neutral;
    const p = (w: "5m" | "15m" | "30m" | "1h") => {
      const v = c.frames[w]?.buyPressurePct;
      return v === undefined ? null : Math.round(v * 100) / 100;
    };
    data[c.symbol] = [
      r5.tally.up,
      r5.tally.down,
      t(r5),
      r15.tally.up,
      r15.tally.down,
      t(r15),
      p("5m"),
      p("15m"),
      p("30m"),
      p("1h"),
      c.price,
    ];
  }
  // One row per minute: the minute the newest candle closed.
  const at = new Date(Math.floor(Date.parse(scalp.asOf) / M) * M);
  const json = data as unknown as Prisma.InputJsonValue;
  await deps.db.scalpReadout.upsert({
    where: { at },
    create: { at, data: json },
    update: { data: json },
  });
  if (at.getUTCMinutes() % 30 === 0)
    await deps.db.scalpReadout.deleteMany({
      where: { at: { lt: new Date(now - READOUT_KEEP_DAYS * DAY) } },
    });

  if (opts.alerts === false) return { recorded: scalp.coins.length, alerts: 0 };
  const alerts = await deps.db.scalpAlert.findMany({ where: { enabled: true } });
  const sent = await checkAlerts(deps, {
    alerts,
    coins: new Map(scalp.coins.map((c) => [c.symbol, c])),
    computedAt: scalp.computedAt,
    inputs,
    full,
    plans: new Map(),
    now,
  });
  return { recorded: scalp.coins.length, alerts: sent };
}

type AlertRow = Awaited<ReturnType<PrismaClient["scalpAlert"]["findMany"]>>[number];
export type Limits = Awaited<ReturnType<typeof planLimits>>;

/**
 * Checks enabled alerts against the given coins. An alert fires when its count is reached, it was
 * not met at the previous check, and its rest time has passed. The rows passed in are updated in
 * place, so a caller that keeps them between checks (the live engine) stays in step.
 */
async function checkAlerts(
  deps: ScalpReadoutDeps,
  x: {
    alerts: AlertRow[];
    coins: Map<string, ScalpCoinDto>;
    computedAt: string;
    inputs: Inputs;
    /** Readings with every part (Premium), when already worked out. */
    full?: Map<string, Record<CockpitTf, ReturnType<typeof readout>>>;
    plans: Map<string, { at: number; limits: Limits }>;
    now: number;
  },
): Promise<number> {
  const { alerts, coins, inputs, now } = x;
  if (alerts.length === 0) return 0;
  const cache = new Map<string, ReturnType<typeof readout>>();
  const readoutOf = (coin: ScalpCoinDto, tf: CockpitTf, fullPlan: boolean) => {
    const pre = fullPlan ? x.full?.get(coin.symbol)?.[tf] : undefined;
    if (pre) return pre;
    const k = `${coin.symbol}:${tf}:${fullPlan}`;
    let r = cache.get(k);
    if (!r) {
      r = readout(coin, tf, inputs, x.computedAt, now, fullPlan);
      cache.set(k, r);
    }
    return r;
  };
  let sent = 0;
  for (const a of alerts) {
    try {
      const coin = coins.get(a.symbol);
      if (!coin) continue;
      let plan = x.plans.get(a.userId);
      if (!plan || now - plan.at > 60_000) {
        plan = { at: now, limits: await planLimits(deps.db, a.userId) };
        x.plans.set(a.userId, plan);
      }
      const limits = plan.limits;
      // A coin past the plan's top coins (gold and silver excepted) is not checked.
      if (!planCovers(limits, coin)) continue;
      const tf = a.tf as CockpitTf;
      const r = readoutOf(coin, tf, limits.marketDesk === 1);
      const met = scalpAlertMet(
        { direction: a.direction as "ANY" | "UP" | "DOWN", minCount: a.minCount, noNews: a.noNews },
        r,
      );
      const rested = !a.lastFiredAt || now - a.lastFiredAt.getTime() >= a.cooldownMin * M;
      const fire = met !== null && !a.lastMet && rested;
      if (fire) {
        const total = r.tally.up + r.tally.down + r.tally.neutral;
        const count = met === "up" ? r.tally.up : r.tally.down;
        const lines = r.rows
          .filter((x) => x.lean === met)
          .slice(0, 4)
          .map((x) => `${x.label}: ${x.value}`);
        const strength = coin.frames[tf]?.strength;
        const atr5m = coin.volatility.atr5m;
        const snapshot =
          atr5m !== null && atr5m > 0 && coin.price > 0
            ? {
                entry: coin.price,
                atr5m,
                rules: {
                  stopRanges: a.planStopRanges,
                  targetR: a.planTargetR,
                  riskUsd: a.planRiskUsd === null ? null : Number(a.planRiskUsd),
                },
              }
            : null;
        await deps.notify({
          userId: a.userId,
          kind: "SCALP_ALERT",
          title: `${nameOf(a.symbol)}: ${count} of ${total} readings lean ${met} on ${tf}`,
          body: [
            strength ? `${tf} strength: ${STRENGTH_LABEL[strength]}.` : "",
            lines.length ? `${lines.join("; ")}.` : "",
            r.flags.length ? `Notes: ${r.flags.map((f) => f.text).join(" ")}` : "",
            snapshot ? planLine(snapshot, formatPrice) : "",
            SCALP_ALERT_DISCLAIMER,
          ]
            .filter(Boolean)
            .join(" "),
          link: `/cockpit?s=${a.symbol}&tf=${tf}${snapshot ? `&${planToQuery({ ...snapshot, at: now })}` : ""}#plan`,
          dedupeKey: `scalp:${a.id}:${Math.floor(now / M)}`,
          allowEmail: limits.setupAlertEmail === 1,
        });
        sent++;
      }
      if (fire || a.lastMet !== (met !== null)) {
        await deps.db.scalpAlert.update({
          where: { id: a.id },
          data: { lastMet: met !== null, ...(fire ? { lastFiredAt: new Date(now) } : {}) },
        });
        a.lastMet = met !== null;
        if (fire) a.lastFiredAt = new Date(now);
      }
    } catch (err) {
      log.warn("scalp alert check failed", { alertId: a.id, err });
    }
  }
  return sent;
}

/**
 * What every live check needs besides the tick, shared by live alerts and paper bots: news, Market
 * Flow and trend inputs and the latest minute snapshot (re-read every 10 seconds, one read at a
 * time), and each user's plan (re-read every minute).
 */
export class LiveBase {
  private inputs: { at: number; value: Inputs } | null = null;
  private snap: { at: number; value: ScalpSnapshot | null } | null = null;
  private loading: Promise<void> | null = null;
  readonly plans = new Map<string, { at: number; limits: Limits }>();

  constructor(private readonly db: PrismaClient) {}

  async refresh(now: number): Promise<{ inputs: Inputs; snap: ScalpSnapshot | null }> {
    const stale = (x: { at: number } | null) => !x || now - x.at >= 10_000;
    if (stale(this.inputs) || stale(this.snap)) {
      this.loading ??= (async () => {
        try {
          const [inputs, row] = await Promise.all([
            loadInputs(this.db, now),
            this.db.marketSnapshot.findUnique({ where: { key: SCALP_KEY } }),
          ]);
          this.inputs = { at: now, value: inputs };
          this.snap = { at: now, value: (row?.data as unknown as ScalpSnapshot) ?? null };
        } finally {
          this.loading = null;
        }
      })();
      await this.loading;
    }
    return {
      inputs: (this.inputs as { value: Inputs }).value,
      snap: (this.snap as { value: ScalpSnapshot | null }).value,
    };
  }

  /** The minute snapshot's coins with the tick's live figures, for the symbols asked for. */
  coins(snap: ScalpSnapshot | null, tick: LiveTick, wanted: Set<string>) {
    const out = new Map<string, ScalpCoinDto>();
    if (!snap?.coins) return out;
    const live = new Map(tick.coins.map((c) => [c.s, c]));
    for (const c of snap.coins) {
      if (!wanted.has(c.symbol)) continue;
      const l = live.get(c.symbol);
      out.set(c.symbol, l ? applyLiveToScalpCoin(c, l) : c);
    }
    return out;
  }

  async limits(userId: string, now: number): Promise<Limits> {
    let plan = this.plans.get(userId);
    if (!plan || now - plan.at > 60_000) {
      plan = { at: now, limits: await planLimits(this.db, userId) };
      this.plans.set(userId, plan);
    }
    return plan.limits;
  }
}

/** Whether a plan covers a market (its top coins, plus gold and silver on every plan). */
export const planCovers = (limits: Limits, coin: Pick<ScalpCoinDto, "symbol" | "rank">) =>
  limits.marketPulseCoins === UNLIMITED ||
  coin.rank <= limits.marketPulseCoins ||
  coin.symbol === "XAUUSDT" ||
  coin.symbol === "XAGUSDT";

/**
 * Scalp alerts within seconds: on every live tick the latest minute snapshot gets the live figures
 * (buying and selling, open interest, price, funding, spread, activity) and every enabled alert is
 * checked with the same rules, rest times and "quiet around news" setting as before. The alert
 * list is re-read every 10 seconds.
 */
export class LiveScalpAlerts {
  private busy = false;
  private alerts: { at: number; rows: AlertRow[] } | null = null;
  private readonly base: LiveBase;

  constructor(
    private readonly deps: ScalpReadoutDeps,
    base?: LiveBase,
  ) {
    this.base = base ?? new LiveBase(deps.db);
  }

  async onTick(tick: LiveTick): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const now = (this.deps.now ?? Date.now)();
      const db = this.deps.db;
      if (!this.alerts || now - this.alerts.at >= 10_000)
        this.alerts = { at: now, rows: await db.scalpAlert.findMany({ where: { enabled: true } }) };
      if (this.alerts.rows.length === 0) return 0;
      const { inputs, snap } = await this.base.refresh(now);
      const coins = this.base.coins(snap, tick, new Set(this.alerts.rows.map((a) => a.symbol)));
      if (coins.size === 0) return 0;
      return await checkAlerts(this.deps, {
        alerts: this.alerts.rows,
        coins,
        computedAt: new Date(tick.at).toISOString(),
        inputs,
        plans: this.base.plans,
        now,
      });
    } finally {
      this.busy = false;
    }
  }
}

/**
 * Stamps recent trades with the Cockpit counts of the minute they opened (the newest record at or
 * up to 3 minutes before the entry). A market that was not scanned at the time is marked so it is
 * not looked up again; trades older than the kept records are left alone.
 */
export async function stampEntryReadouts(db: PrismaClient, now = Date.now()): Promise<number> {
  const trades = await db.$queryRaw<Array<{ id: string; baseAsset: string; openedAt: Date }>>`
    SELECT id, base_asset AS "baseAsset", opened_at AS "openedAt" FROM positions
     WHERE entry_readout IS NULL
       AND opened_at >= ${new Date(now - READOUT_KEEP_DAYS * DAY + 10 * M)}
       AND opened_at <= ${new Date(now)}
     ORDER BY opened_at DESC LIMIT 2000`;
  if (trades.length === 0) return 0;
  const minutes = [
    ...new Set(
      trades.flatMap((t) => {
        const m = Math.floor(t.openedAt.getTime() / M) * M;
        return [m, m - M, m - 2 * M, m - 3 * M];
      }),
    ),
  ];
  const rows = new Map<number, Record<string, ReadoutRecord>>();
  for (let i = 0; i < minutes.length; i += 500) {
    const part = await db.scalpReadout.findMany({
      where: { at: { in: minutes.slice(i, i + 500).map((m) => new Date(m)) } },
    });
    for (const r of part) rows.set(r.at.getTime(), r.data as Record<string, ReadoutRecord>);
  }
  let stamped = 0;
  for (const t of trades) {
    const m = Math.floor(t.openedAt.getTime() / M) * M;
    const minute = [m, m - M, m - 2 * M, m - 3 * M].find((x) => rows.has(x));
    if (minute === undefined) continue; // no record for that time (yet, or ever)
    const data = rows.get(minute) as Record<string, ReadoutRecord>;
    const base = t.baseAsset.toUpperCase().replace(/^1000(?=[A-Z])/, "");
    const rec = data[`${base}USDT`] ?? data[`1000${base}USDT`];
    const value: StoredEntryReadout = rec ? entryFromRecord(new Date(minute), rec) : { none: true };
    await db.position.update({
      where: { id: t.id },
      data: { entryReadout: value as unknown as Prisma.InputJsonValue },
    });
    stamped++;
  }
  return stamped;
}
