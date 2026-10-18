"use client";

import {
  NEWS_CATEGORY_INFO,
  type NewsImpact,
  type NewsItemDto,
  type NewsReactionDto,
} from "@atc/shared";
import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { loadMoreNewsAction } from "./actions";
import { ImpactBadge } from "./impact";
import { useLiveHeadlines } from "./live-news";

export type NewsFolder = "top" | NewsItemDto["category"];
export type ImpactFilter = "ALL" | "MEDIUM" | "HIGH";

const RANK: Record<NewsImpact, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/** Whether a live headline belongs in this folder and filter. */
export function fits(item: NewsItemDto, folder: NewsFolder, impact: ImpactFilter): boolean {
  if (folder === "top") return item.impact === "HIGH";
  if (item.category !== folder) return false;
  return impact === "ALL" || RANK[item.impact] >= RANK[impact];
}

function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export function timeAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short" });
}

const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`;

function Reaction({ r }: { r: NewsReactionDto }) {
  const cells: Array<[string, number | null]> = [
    ["BTC 15m", r.btc15m],
    ["BTC 1h", r.btc60m],
    ["Gold 15m", r.gold15m],
    ["Gold 1h", r.gold60m],
  ];
  const shown = cells.filter(([, v]) => v !== null) as Array<[string, number]>;
  if (shown.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="text-ink-faint">Market after:</span>
      {shown.map(([k, v]) => (
        <span key={k} className="figures whitespace-nowrap">
          {k}{" "}
          <span className={v > 0 ? "text-profit" : v < 0 ? "text-loss" : "text-ink-muted"}>
            {pct(v)}
          </span>
        </span>
      ))}
    </p>
  );
}

export function HeadlineRow({
  item,
  now,
  showFolder,
  compact,
  isNew,
}: {
  item: NewsItemDto;
  now: number;
  showFolder?: boolean;
  compact?: boolean;
  isNew?: boolean;
}) {
  return (
    <li
      className={cn(
        "grid gap-1.5 py-3 first:pt-0 last:pb-0",
        isNew && "animate-[pulse_1.2s_ease-in-out_2]",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
        <ImpactBadge impact={item.impact} />
        <time dateTime={item.publishedAt} title={new Date(item.publishedAt).toLocaleString()}>
          {timeAgo(item.publishedAt, now)}
        </time>
        <span>
          {item.publisher}
          {item.alsoReportedBy > 0 && ` +${item.alsoReportedBy} more`}
        </span>
        {showFolder && (
          <span className="rounded-full bg-hi/[0.06] px-2 py-px">
            {NEWS_CATEGORY_INFO[item.category].label}
          </span>
        )}
        {isNew && <span className="font-semibold text-loss">NEW</span>}
      </div>
      {item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={cn(
            "group inline-flex items-start gap-1.5 font-medium hover:text-coach",
            compact ? "text-sm" : "text-[15px]",
          )}
        >
          <span>{item.title}</span>
          <ExternalLink
            className="mt-1 h-3 w-3 shrink-0 opacity-0 group-hover:opacity-70"
            aria-hidden="true"
          />
        </a>
      ) : (
        <p className={cn("font-medium", compact ? "text-sm" : "text-[15px]")}>{item.title}</p>
      )}
      {!compact && item.summary && (
        <p className="line-clamp-2 text-sm text-ink-muted">{item.summary}</p>
      )}
      {item.why && <p className="text-xs text-ink-muted">Why it matters: {item.why}</p>}
      {item.reaction && <Reaction r={item.reaction} />}
    </li>
  );
}

/**
 * A folder's headlines: the stored ones plus every new one that arrives live (no reload needed),
 * with "Load more" for older stories.
 */
export function HeadlineFeed({
  folder,
  impact = "ALL",
  initial,
  nextCursor,
  compact = false,
  limit,
  emptyText = "No headlines here yet. New ones appear the moment they are published.",
}: {
  folder: NewsFolder;
  impact?: ImpactFilter;
  initial: NewsItemDto[];
  nextCursor: string | null;
  compact?: boolean;
  /** Show at most this many (dashboard). */
  limit?: number;
  emptyText?: string;
}) {
  const now = useNow();
  const live = useLiveHeadlines();
  const [older, setOlder] = useState<NewsItemDto[]>([]);
  const [cursor, setCursor] = useState(nextCursor);
  const [pending, start] = useTransition();

  const items = useMemo(() => {
    const fresh = live.filter((h) => fits(h, folder, impact));
    const seen = new Set<string>();
    const out: Array<NewsItemDto & { isNew?: boolean }> = [];
    for (const [list, isNew] of [
      [fresh, true],
      [initial, false],
      [older, false],
    ] as const) {
      for (const h of list) {
        if (seen.has(h.id)) continue;
        seen.add(h.id);
        out.push({ ...h, isNew });
      }
    }
    out.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    return limit ? out.slice(0, limit) : out;
  }, [live, initial, older, folder, impact, limit]);

  const more = () =>
    start(async () => {
      if (!cursor) return;
      const page = await loadMoreNewsAction({ folder, impact, cursor });
      if (!page) return;
      setOlder((o) => [...o, ...page.items]);
      setCursor(page.nextCursor);
    });

  if (items.length === 0) return <p className="text-sm text-ink-muted">{emptyText}</p>;
  return (
    <div className="grid gap-4">
      <ul className="grid divide-y divide-rule">
        {items.map((h) => (
          <HeadlineRow
            key={h.id}
            item={h}
            now={now}
            showFolder={folder === "top"}
            compact={compact}
            isNew={h.isNew}
          />
        ))}
      </ul>
      {!limit && cursor && (
        <Button
          variant="secondary"
          size="sm"
          onClick={more}
          disabled={pending}
          className="justify-self-center"
        >
          {pending ? "Loading…" : "Load older news"}
        </Button>
      )}
    </div>
  );
}
