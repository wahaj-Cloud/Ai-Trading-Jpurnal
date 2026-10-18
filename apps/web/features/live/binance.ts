"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveCandle, LiveInterval } from "./market";

export * from "./market";

/**
 * Binance USDⓈ-M futures public market data, read straight from the trader's browser: no API key,
 * no load on our servers, and prices arrive within a second. Binance refuses visitors from some
 * regions (e.g. the USA); the UI says so instead of showing stale numbers.
 */

const REST = "https://fapi.binance.com";
/**
 * Market streams (tickers, klines) live under /market since Binance split its futures WebSocket in
 * March 2026; the old /stream URL still connects but stopped sending these channels on 2026-04-23.
 */
const WS = "wss://fstream.binance.com/market/stream?streams=";
/** No message for this long on a live socket means the feed has stalled: reconnect. */
const STALL_MS = 30_000;

export interface MiniTicker {
  symbol: string;
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  /** 24h traded value in USDT. */
  quoteVolume: number;
  change: number;
}

export type FeedStatus = "connecting" | "live" | "reconnecting" | "blocked";

export class BlockedError extends Error {}

/** Candles ending now, or (with `endTime`, ms) older history for scrolling back. */
export async function fetchCandles(
  symbol: string,
  interval: LiveInterval,
  limit = 500,
  signal?: AbortSignal,
  endTime?: number,
): Promise<LiveCandle[]> {
  const end = endTime === undefined ? "" : `&endTime=${Math.floor(endTime)}`;
  const res = await fetch(
    `${REST}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}${end}`,
    { signal, cache: "no-store" },
  );
  if (res.status === 451 || res.status === 403) throw new BlockedError("region");
  if (!res.ok) throw new Error(`Binance answered ${res.status}`);
  const rows = (await res.json()) as unknown[][];
  return rows.map((r) => ({
    time: Math.floor(Number(r[0]) / 1000),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
    closeTime: Number(r[6]),
  }));
}

/** A kline stream message's candle (`k`), or null. */
export function parseKline(d: unknown): LiveCandle | null {
  const k = (
    d as {
      k?: { t: number; T: number; o: string; h: string; l: string; c: string; v: string };
    } | null
  )?.k;
  if (!k) return null;
  return {
    time: Math.floor(k.t / 1000),
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
    closeTime: Number(k.T),
  };
}

/**
 * One live WebSocket to Binance's combined stream, reconnecting with backoff. `onMessage` gets each
 * message's `data`. Closing the page or changing `streams` closes the socket.
 */
export function useBinanceStream(
  streams: readonly string[],
  onMessage: (data: unknown) => void,
): FeedStatus {
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const key = streams.join("/");

  useEffect(() => {
    if (!key) return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let opened = false;
    let lastMessage = 0;

    const connect = () => {
      if (stopped) return;
      opened = false;
      ws = new WebSocket(WS + key);
      ws.onopen = () => {
        opened = true;
        lastMessage = Date.now();
        setStatus("live");
      };
      ws.onmessage = (ev) => {
        lastMessage = Date.now();
        attempt = 0;
        try {
          handler.current((JSON.parse(String(ev.data)) as { data: unknown }).data);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        // Never opened after several tries: almost always a regional block.
        if (!opened && attempt >= 3) {
          setStatus("blocked");
        } else setStatus("reconnecting");
        const delay = Math.min(30_000, 1_000 * 2 ** attempt++);
        timer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws?.close();
    };
    setStatus("connecting");
    connect();
    // An open socket that stops delivering (an exchange-side change, a sleeping laptop, a proxy)
    // looks "live" forever; close it so the reconnect logic takes over.
    watchdog = setInterval(() => {
      if (opened && ws?.readyState === WebSocket.OPEN && Date.now() - lastMessage > STALL_MS) {
        setStatus("reconnecting");
        ws.close();
      }
    }, 5_000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (watchdog) clearInterval(watchdog);
      ws?.close();
    };
  }, [key]);

  return status;
}

export function parseMiniTicker(d: {
  s: string;
  c: string;
  o: string;
  h: string;
  l: string;
  q: string;
}): MiniTicker {
  const price = Number(d.c);
  const open24h = Number(d.o);
  return {
    symbol: d.s,
    price,
    open24h,
    high24h: Number(d.h),
    low24h: Number(d.l),
    quoteVolume: Number(d.q),
    change: open24h > 0 ? price / open24h - 1 : 0,
  };
}
