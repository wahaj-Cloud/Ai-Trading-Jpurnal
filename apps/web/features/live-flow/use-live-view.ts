"use client";

import type { LiveView, LiveViewKind, OrderflowWindow } from "@atc/shared";
import { useEffect, useState } from "react";
import { useLiveNews } from "@/features/news/live-news";
import { getLiveTicketAction } from "./actions";

export type LiveStatus = "connecting" | "live" | "offline";

/**
 * Live order flow for one page: a ticket from the signed-in app, then the API's stream, one view
 * a second. On any break it fetches a fresh ticket and reconnects, waiting a little longer each
 * time (1 s up to 15 s), so a server restart or a dropped network heals by itself.
 */
export function useLiveView(q: {
  view: LiveViewKind;
  w?: OrderflowWindow;
  s?: string;
  enabled?: boolean;
}): { data: LiveView | null; status: LiveStatus } {
  const { apiUrl } = useLiveNews();
  const [data, setData] = useState<LiveView | null>(null);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const enabled = q.enabled ?? true;
  const { view, w, s } = q;

  useEffect(() => {
    setData(null);
    if (!enabled || !apiUrl || typeof EventSource === "undefined") {
      setStatus("offline");
      return;
    }
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let closed = false;
    const reconnect = () => {
      es?.close();
      es = null;
      if (closed) return;
      setStatus(attempt > 1 ? "offline" : "connecting");
      retry = setTimeout(open, Math.min(15_000, 1_000 * 2 ** attempt++));
    };
    const open = async () => {
      const t = await getLiveTicketAction();
      if (closed) return;
      if (!t) return reconnect();
      const p = new URLSearchParams({ ticket: t.ticket, view });
      if (w) p.set("w", w);
      if (s) p.set("s", s);
      es = new EventSource(`${apiUrl.replace(/\/$/, "")}/v1/market/live/stream?${p}`);
      es.addEventListener("tick", (msg) => {
        try {
          setData(JSON.parse((msg as MessageEvent<string>).data) as LiveView);
          setStatus("live");
          attempt = 0;
        } catch {
          // ignore a malformed message
        }
      });
      // The ticket is single-use per connection: never let the browser retry with it.
      es.onerror = () => reconnect();
    };
    void open();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [apiUrl, enabled, view, w, s]);

  return { data, status };
}
