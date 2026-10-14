"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Binance USDⓈ-M futures public market data, read straight from the trader's browser: no API key,
 * no load on our servers, and prices arrive within a second. Binance refuses visitors from some
 * regions (e.g. the USA); the UI says so instead of showing stale numbers.
 */

const REST = "https://fapi.binance.com";
const WS = "wss://fstream.binance.com/stream?streams=";

export const LIVE_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type LiveInterval = (typeof LIVE_INTERVALS)[number];

export interface LiveCandle {
  /** Open time, seconds (UTC). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

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

export async function fetchCandles(
  symbol: string,
  interval: LiveInterval,
  limit = 500,
  signal?: AbortSignal,
): Promise<LiveCandle[]> {
  const res = await fetch(
    `${REST}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`,
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
  }));
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
    let opened = false;

    const connect = () => {
      if (stopped) return;
      opened = false;
      ws = new WebSocket(WS + key);
      ws.onopen = () => {
        opened = true;
        attempt = 0;
        setStatus("live");
      };
      ws.onmessage = (ev) => {
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
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
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

/** Prices to a sensible number of decimals for their size (63,512.4 · 0.15432 · 0.00001234). */
export function formatPrice(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 1 : abs >= 1 ? 3 : abs >= 0.01 ? 5 : 8;
  return v.toLocaleString("en", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const formatChange = (c: number) => {
  const pct = Number((c * 100).toFixed(2));
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(2)}%`;
};
