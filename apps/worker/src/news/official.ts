import type { PrismaClient } from "@atc/db";
import type { Redis } from "ioredis";
import { log } from "../logger.js";
import { applyRelease } from "./live.js";

/**
 * Free live results for the US releases that move crypto and gold most, read straight from the
 * official publisher: the US Bureau of Labor Statistics (CPI, PPI, jobs report). Around each
 * scheduled release the worker asks the BLS API every few seconds until the new month's figure is
 * out, then saves and pushes it like any live result.
 */

type Field = "pct1" | "pct12" | "net1K" | "valuePct";

/** Calendar titles (Forex Factory, USD) → the BLS series and figure that answer them. */
export const OFFICIAL_RELEASES: Array<{ match: RegExp; series: string; field: Field }> = [
  { match: /^core cpi m\/m$/i, series: "CUSR0000SA0L1E", field: "pct1" },
  { match: /^core cpi y\/y$/i, series: "CUUR0000SA0L1E", field: "pct12" },
  { match: /^cpi m\/m$/i, series: "CUSR0000SA0", field: "pct1" },
  { match: /^cpi y\/y$/i, series: "CUUR0000SA0", field: "pct12" },
  { match: /^ppi m\/m$/i, series: "WPSFD4", field: "pct1" },
  { match: /^non-farm employment change$/i, series: "CES0000000001", field: "net1K" },
  { match: /^unemployment rate$/i, series: "LNS14000000", field: "valuePct" },
  { match: /^average hourly earnings m\/m$/i, series: "CES0500000003", field: "pct1" },
];

export const specFor = (title: string) => OFFICIAL_RELEASES.find((r) => r.match.test(title.trim()));

export interface Observation {
  /** YYYY-MM */
  period: string;
  value: string;
  pct1: string | null;
  pct12: string | null;
  net1: string | null;
}

/** BLS API v2 response → latest observation per series (with its calculations). */
export function parseBls(json: unknown): Map<string, Observation> {
  const out = new Map<string, Observation>();
  const body = json as {
    status?: string;
    Results?: {
      series?: Array<{
        seriesID: string;
        data?: Array<{
          year: string;
          period: string;
          value: string;
          calculations?: {
            pct_changes?: Record<string, string>;
            net_changes?: Record<string, string>;
          };
        }>;
      }>;
    };
  };
  for (const s of body?.Results?.series ?? []) {
    // Monthly periods only (M01..M12); BLS lists the newest first.
    const d = (s.data ?? []).find((x) => /^M(0[1-9]|1[0-2])$/.test(x.period));
    if (!d) continue;
    out.set(s.seriesID, {
      period: `${d.year}-${d.period.slice(1)}`,
      value: d.value,
      pct1: d.calculations?.pct_changes?.["1"] ?? null,
      pct12: d.calculations?.pct_changes?.["12"] ?? null,
      net1: d.calculations?.net_changes?.["1"] ?? null,
    });
  }
  return out;
}

/** The figure as calendars print it: "0.3%", "2.9%", "254K", "4.1%". */
export function formatFigure(field: Field, o: Observation): string | null {
  const n = (v: string | null) =>
    v === null || v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v);
  switch (field) {
    case "pct1":
      return n(o.pct1) === null ? null : `${n(o.pct1)?.toFixed(1)}%`;
    case "pct12":
      return n(o.pct12) === null ? null : `${n(o.pct12)?.toFixed(1)}%`;
    case "valuePct":
      return n(o.value) === null ? null : `${n(o.value)?.toFixed(1)}%`;
    case "net1K": {
      const v = n(o.net1);
      return v === null ? null : `${Math.round(v)}K`;
    }
  }
}

/** These monthly reports describe the previous calendar month (released mid-month or first Friday). */
export function expectedPeriod(releaseAt: Date): string {
  const y = releaseAt.getUTCFullYear();
  const m = releaseAt.getUTCMonth(); // 0-based → previous month in 1-based terms
  return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, "0")}`;
}

const API = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
/** Ask every 1.5 s in the first two minutes after release time, then every 5 s… */
const FAST_POLL_MS = 1_500;
const FAST_WINDOW_MS = 2 * 60_000;
const SLOW_POLL_MS = 5_000;
/** …starting just before it, and giving up 10 minutes after. */
const LEAD_MS = 2_000;
const GIVE_UP_MS = 10 * 60_000;
/** BLS allows 500 requests a day with a free key; stay under it. */
const DAILY_BUDGET = 450;

export interface OfficialOptions {
  key: string;
  db: PrismaClient;
  redis: Pick<Redis, "publish">;
  fetchImpl?: typeof fetch;
}

export function startOfficialWatcher(opts: OfficialOptions): { stop: () => void } {
  const doFetch = opts.fetchImpl ?? fetch;
  let lastPoll = 0;
  let busy = false;
  let day = "";
  let used = 0;

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = Date.now();
      const due = await opts.db.economicEvent.findMany({
        where: {
          currency: "USD",
          actual: null,
          tentative: false,
          startsAt: { gte: new Date(now - GIVE_UP_MS), lte: new Date(now + LEAD_MS) },
        },
        select: { id: true, title: true, startsAt: true },
      });
      const wanted = due
        .map((e) => ({ e, spec: specFor(e.title) }))
        .filter(
          (x): x is { e: (typeof due)[number]; spec: NonNullable<ReturnType<typeof specFor>> } =>
            Boolean(x.spec),
        );
      const first = Math.min(...wanted.map((w) => w.e.startsAt.getTime()));
      const pollMs = now - first < FAST_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS;
      if (wanted.length === 0 || now - lastPoll < pollMs) return;

      const today = new Date(now).toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        used = 0;
      }
      if (used >= DAILY_BUDGET) return;
      used++;
      lastPoll = now;

      const year = new Date(now).getUTCFullYear();
      const res = await doFetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({
          seriesid: [...new Set(wanted.map((w) => w.spec.series))],
          startyear: String(year - 1),
          endyear: String(year),
          calculations: true,
          registrationkey: opts.key,
        }),
      });
      if (!res.ok) throw new Error(`BLS answered ${res.status}`);
      const latest = parseBls(await res.json());

      for (const { e, spec } of wanted) {
        const obs = latest.get(spec.series);
        // Only the new month counts: before release the API still shows the month before.
        if (!obs || obs.period !== expectedPeriod(e.startsAt)) continue;
        const actual = formatFigure(spec.field, obs);
        if (!actual) continue;
        const update = await applyRelease(
          opts.db,
          opts.redis,
          {
            providerId: `bls:${spec.series}:${obs.period}`,
            title: e.title,
            currency: "USD",
            importance: 3,
            startsAt: e.startsAt,
            actual,
            forecast: null,
            previous: null,
          },
          "bls",
        );
        if (update) {
          log.info("official release", {
            title: e.title,
            actual,
            secondsAfterScheduled: Math.round((Date.now() - e.startsAt.getTime()) / 1000),
          });
        }
      }
    } catch (err) {
      log.warn("official release check failed", { err: (err as Error).message });
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => void tick(), 500);
  return { stop: () => clearInterval(timer) };
}
