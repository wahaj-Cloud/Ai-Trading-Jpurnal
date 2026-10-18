"use client";

import type {
  EconomicEventDto,
  EconomicLiveUpdate,
  NewsItemDto,
  NewsLiveUpdate,
} from "@atc/shared";
import { Newspaper, Radio, X } from "lucide-react";
import Link from "next/link";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { CurrencyFlag } from "./currency-flag";
import { marketReaction } from "./reaction";

type LiveMap = Record<string, EconomicEventDto>;
const LiveContext = createContext<{
  live: LiveMap;
  connected: boolean;
  /** Headlines that arrived live since the page loaded, newest first. */
  headlines: NewsItemDto[];
}>({
  live: {},
  connected: false,
  headlines: [],
});

/** Live headlines, newest first (Medium and High; the stream never carries Low ones). */
export function useLiveHeadlines(): NewsItemDto[] {
  return useContext(LiveContext).headlines;
}

/** An event with any figure that arrived live since the page loaded. */
export function useLiveEvent<T extends EconomicEventDto>(e: T): T {
  const { live } = useContext(LiveContext);
  const u = live[e.id];
  return u
    ? {
        ...e,
        actual: u.actual ?? e.actual,
        forecast: e.forecast ?? u.forecast,
        actualSource: e.actualSource ?? u.actualSource,
        actualAt: e.actualAt ?? u.actualAt,
      }
    : e;
}

const SOURCE_NAMES: Record<string, string> = {
  bls: "US BLS (official)",
  tradingeconomics: "Trading Economics",
};

/** "via US BLS (official) · 2s after release" — which source was first, and how fast. */
export function deliveredLabel(e: EconomicEventDto): string | null {
  if (!e.actualSource || !e.actualAt) return null;
  const name = SOURCE_NAMES[e.actualSource] ?? e.actualSource;
  const secs = Math.round((new Date(e.actualAt).getTime() - new Date(e.startsAt).getTime()) / 1000);
  const speed =
    secs < 0
      ? ""
      : secs < 90
        ? ` · ${secs}s after release`
        : ` · ${Math.round(secs / 60)} min after release`;
  return `via ${name}${speed}`;
}

export function useLiveNews() {
  return useContext(LiveContext);
}

type Toast = { key: string; event: EconomicEventDto } | { key: string; headline: NewsItemDto };

/**
 * Keeps one live connection (server-sent events) to the API for the whole app. Released figures
 * land in every open view without a reload, and high-impact ones pop up as a toast.
 */
export function LiveNewsProvider({
  apiUrl,
  children,
}: {
  apiUrl: string | null;
  children: ReactNode;
}) {
  const [live, setLive] = useState<LiveMap>({});
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [headlines, setHeadlines] = useState<NewsItemDto[]>([]);

  const dismiss = useCallback(
    (key: string) => setToasts((t) => t.filter((x) => x.key !== key)),
    [],
  );

  useEffect(() => {
    if (!apiUrl || typeof EventSource === "undefined") return;
    const es = new EventSource(`${apiUrl.replace(/\/$/, "")}/v1/economic-calendar/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // the browser reconnects by itself
    es.addEventListener("release", (msg) => {
      try {
        const u = JSON.parse((msg as MessageEvent<string>).data) as EconomicLiveUpdate;
        setLive((m) => ({ ...m, [u.event.id]: u.event }));
        if (u.event.impact === "HIGH") {
          const key = `${u.event.id}:${u.event.actual}`;
          setToasts((t) => [...t.filter((x) => x.key !== key), { key, event: u.event }].slice(-3));
          setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), 45_000);
        }
      } catch {
        // ignore malformed messages
      }
    });
    es.addEventListener("headline", (msg) => {
      try {
        const h = JSON.parse((msg as MessageEvent<string>).data) as NewsLiveUpdate;
        const item = h.item;
        setHeadlines((list) => [item, ...list.filter((x) => x.id !== item.id)].slice(0, 100));
        if (item.impact === "HIGH") {
          const key = `h:${item.id}`;
          setToasts((t) => [...t.filter((x) => x.key !== key), { key, headline: item }].slice(-3));
          setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), 60_000);
        }
      } catch {
        // ignore malformed messages
      }
    });
    return () => es.close();
  }, [apiUrl]);

  return (
    <LiveContext.Provider value={{ live, connected, headlines }}>
      {children}
      {toasts.length > 0 && (
        <div className="pointer-events-none fixed inset-x-3 top-20 z-50 grid justify-items-end gap-2 sm:right-6 sm:left-auto">
          {toasts.map((t) =>
            "headline" in t ? (
              <HeadlineToast key={t.key} item={t.headline} onClose={() => dismiss(t.key)} />
            ) : (
              <ReleaseToast key={t.key} event={t.event} onClose={() => dismiss(t.key)} />
            ),
          )}
        </div>
      )}
    </LiveContext.Provider>
  );
}

function HeadlineToast({ item, onClose }: { item: NewsItemDto; onClose: () => void }) {
  return (
    <div
      role="alert"
      className="pointer-events-auto w-full max-w-sm rounded-2xl border border-loss/50 bg-sheet p-4 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.9)]"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-loss text-white">
          <Newspaper className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-wide text-loss uppercase">
            High-impact news · {item.publisher}
          </p>
          <p className="mt-0.5 font-semibold">{item.title}</p>
          {item.why && <p className="mt-1 text-xs text-ink-muted">{item.why}</p>}
          <Link
            href="/news/top"
            className="mt-1 inline-block text-xs text-coach underline-offset-4 hover:underline"
          >
            Top stories
          </Link>
        </div>
        <button type="button" onClick={onClose} className="text-ink-faint hover:text-ink">
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Dismiss</span>
        </button>
      </div>
    </div>
  );
}

function ReleaseToast({ event, onClose }: { event: EconomicEventDto; onClose: () => void }) {
  const r = marketReaction(event);
  const verdict =
    r.outcome === "higher"
      ? "Above forecast"
      : r.outcome === "lower"
        ? "Below forecast"
        : r.outcome === "inline"
          ? "As expected"
          : null;
  const moves = r.outcome === "higher" ? r.higher : r.outcome === "lower" ? r.lower : [];
  return (
    <div
      role="alert"
      className="pointer-events-auto w-full max-w-sm rounded-2xl border border-loss/50 bg-sheet p-4 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.9)]"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-loss text-white">
          <Radio className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-wide text-loss uppercase">
            Just released
          </p>
          <p className="mt-0.5 flex items-center gap-2 font-semibold">
            <CurrencyFlag currency={event.currency} />
            {event.currency} {event.title}
          </p>
          <p className="figures mt-1 text-sm">
            Actual <strong className="text-ink">{event.actual}</strong>
            {event.forecast && <span className="text-ink-muted"> · forecast {event.forecast}</span>}
            {verdict && (
              <span
                className={cn(
                  "ml-2 rounded-full px-2 py-px text-[11px] font-semibold",
                  r.outcome === "inline" ? "bg-hi/10 text-ink-muted" : "bg-coach/20 text-coach",
                )}
              >
                {verdict}
              </span>
            )}
          </p>
          {moves.length > 0 && (
            <p className="mt-1 text-xs text-ink-muted">
              Usual reaction:{" "}
              {moves.map((m) => (
                <span key={m.market} className="mr-2 whitespace-nowrap">
                  {m.market}{" "}
                  <span className={m.dir === "up" ? "text-profit" : "text-loss"}>
                    {m.dir === "up" ? "▲" : "▼"}
                  </span>
                </span>
              ))}
            </p>
          )}
          {deliveredLabel(event) && (
            <p className="mt-1 text-[11px] text-ink-faint">{deliveredLabel(event)}</p>
          )}
          <Link
            href="/news"
            className="mt-1 inline-block text-xs text-coach underline-offset-4 hover:underline"
          >
            Economic calendar
          </Link>
        </div>
        <button type="button" onClick={onClose} className="text-ink-faint hover:text-ink">
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Dismiss</span>
        </button>
      </div>
    </div>
  );
}

/** The Actual figure of a release, updating live. */
export function LiveActual({ event }: { event: EconomicEventDto }) {
  const e = useLiveEvent(event);
  const via = deliveredLabel(e);
  return e.actual ? (
    <span className="figures font-semibold text-ink" title={via ?? undefined}>
      {e.actual}
      {via && (
        <span className="block text-[10px] font-normal whitespace-nowrap text-ink-faint">
          {via.replace(/^via /, "")}
        </span>
      )}
    </span>
  ) : (
    <span className="text-ink-faint">—</span>
  );
}
