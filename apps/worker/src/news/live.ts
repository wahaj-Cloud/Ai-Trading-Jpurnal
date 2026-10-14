import type { PrismaClient } from "@atc/db";
import { ECON_LIVE_CHANNEL, type EconomicLiveUpdate, type Impact } from "@atc/shared";
import type { Redis } from "ioredis";
import { log } from "../logger.js";
import { matchRelease, type ProviderRelease, parseProviderMessage } from "./match.js";

const IMPACT: Record<number, Impact> = { 3: "HIGH", 2: "MEDIUM", 1: "LOW" };
const SOURCE = "tradingeconomics";
const WINDOW_MS = 10 * 60_000;

/**
 * Saves a released figure on its calendar row (or adds the release if the calendar never listed
 * it) and publishes it for the API to push to every open browser. Returns the update, or null when
 * nothing changed (the provider repeats messages).
 */
export async function applyRelease(
  db: PrismaClient,
  redis: Pick<Redis, "publish">,
  r: ProviderRelease,
  /** Who delivered it: "bls" (official, free) or "tradingeconomics" (paid stream). */
  sourceName: string,
  now = new Date(),
): Promise<EconomicLiveUpdate | null> {
  const nearby = await db.economicEvent.findMany({
    where: {
      currency: r.currency,
      startsAt: {
        gte: new Date(r.startsAt.getTime() - WINDOW_MS),
        lte: new Date(r.startsAt.getTime() + WINDOW_MS),
      },
    },
  });
  const match = matchRelease(r, nearby);
  let row = match ? nearby.find((n) => n.id === match.id) : undefined;
  if (row) {
    if (row.actual === r.actual) return null;
    // First source to deliver wins the credit; a later revision updates the figure only.
    const first = row.actual === null;
    row = await db.economicEvent.update({
      where: { id: row.id },
      data: {
        actual: r.actual,
        forecast: row.forecast ?? r.forecast,
        previous: row.previous ?? r.previous,
        ...(first && { actualSource: sourceName, actualAt: now }),
      },
    });
  } else {
    // Only add releases the calendar does not already cover, so names never appear twice.
    if (r.importance < 2) return null;
    const id = `te:${r.providerId}`.slice(0, 64);
    const existing = await db.economicEvent.findUnique({ where: { id } });
    if (existing?.actual === r.actual) return null;
    const data = {
      title: r.title,
      currency: r.currency,
      impact: IMPACT[r.importance] ?? "LOW",
      startsAt: r.startsAt,
      tentative: false,
      actual: r.actual,
      forecast: r.forecast,
      previous: r.previous,
      source: SOURCE,
      fetchedAt: now,
      actualSource: existing?.actualSource ?? sourceName,
      actualAt: existing?.actualAt ?? now,
    };
    row = await db.economicEvent.upsert({ where: { id }, create: { id, ...data }, update: data });
  }
  const update: EconomicLiveUpdate = {
    type: "release",
    receivedAt: now.toISOString(),
    event: {
      id: row.id,
      title: row.title,
      currency: row.currency,
      impact: row.impact as Impact,
      startsAt: row.startsAt.toISOString(),
      tentative: row.tentative,
      actual: row.actual,
      forecast: row.forecast,
      previous: row.previous,
      actualSource: row.actualSource,
      actualAt: row.actualAt?.toISOString() ?? null,
    },
  };
  await redis.publish(ECON_LIVE_CHANNEL, JSON.stringify(update));
  return update;
}

export interface LiveNewsOptions {
  url: string;
  key: string;
  db: PrismaClient;
  redis: Pick<Redis, "publish">;
}

/**
 * Keeps one WebSocket open to the data provider's calendar stream. Released figures are pushed to
 * us the moment they are published; each is saved and relayed within milliseconds. Reconnects with
 * backoff, and forces a reconnect if the line goes silent.
 */
export function startLiveNews(opts: LiveNewsOptions): { stop: () => void } {
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let idle: NodeJS.Timeout | null = null;
  let retry: NodeJS.Timeout | null = null;
  const IDLE_MS = 5 * 60_000;

  const bump = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => {
      log.warn("live news stream silent, reconnecting");
      ws?.close();
    }, IDLE_MS);
  };

  const connect = () => {
    if (stopped) return;
    const url = new URL(opts.url);
    url.searchParams.set("client", opts.key);
    ws = new WebSocket(url);
    ws.addEventListener("open", () => {
      attempt = 0;
      bump();
      ws?.send(JSON.stringify({ topic: "subscribe", to: "calendar" }));
      log.info("live news stream connected");
    });
    ws.addEventListener("message", async (ev) => {
      bump();
      try {
        const raw =
          typeof ev.data === "string"
            ? ev.data
            : ev.data instanceof ArrayBuffer
              ? new TextDecoder().decode(ev.data)
              : await (ev.data as Blob).text();
        const release = parseProviderMessage(JSON.parse(raw));
        if (!release) return;
        const update = await applyRelease(opts.db, opts.redis, release, "tradingeconomics");
        if (update) {
          const lag = Date.now() - new Date(update.event.startsAt).getTime();
          log.info("live release", {
            title: update.event.title,
            currency: update.event.currency,
            actual: update.event.actual,
            secondsAfterScheduled: Math.round(lag / 1000),
          });
        }
      } catch (err) {
        log.warn("live news message failed", { err: (err as Error).message });
      }
    });
    ws.addEventListener("close", () => {
      if (idle) clearTimeout(idle);
      if (stopped) return;
      const delay = Math.min(60_000, 1_000 * 2 ** attempt++);
      log.warn("live news stream closed, reconnecting", { inMs: delay });
      retry = setTimeout(connect, delay);
    });
    ws.addEventListener("error", () => ws?.close());
  };

  connect();
  return {
    stop: () => {
      stopped = true;
      if (idle) clearTimeout(idle);
      if (retry) clearTimeout(retry);
      ws?.close();
    },
  };
}
