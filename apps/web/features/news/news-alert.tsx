"use client";

import type { EconomicEventDto } from "@atc/shared";
import { Siren, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { formatClock, formatUntil } from "./calendar-view";
import { CurrencyFlag } from "./currency-flag";
import { useLiveNews } from "./live-news";
import { marketReaction } from "./reaction";
import { ReactionHint } from "./reaction-view";

/** Shown from an hour before a high-impact release until 15 minutes after it. */
const LEAD_MS = 60 * 60_000;
const AFTER_MS = 15 * 60_000;
/** The final countdown: big red clock with seconds. */
const FINAL_MS = 5 * 60_000;

/**
 * Dashboard alert for high-impact news: amber an hour before, a red pulsing MM:SS clock in the last
 * five minutes, and a "volatile now" notice for 15 minutes after the release. Shows how the market
 * usually reacts to each outcome.
 */
export function NewsAlert({ events: initial }: { events: EconomicEventDto[] }) {
  const { live } = useLiveNews();
  // Figures released while the page is open replace the loaded ones.
  const events = initial.map((e) =>
    live[e.id] ? { ...e, actual: live[e.id]?.actual ?? e.actual } : e,
  );
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  // Rendered only in the browser, so the server and client never disagree about the time.
  if (now === null) return null;

  const high = events
    .filter((e) => e.impact === "HIGH" && !e.tentative)
    .map((e) => ({ e, t: new Date(e.startsAt).getTime() }))
    .filter(({ t }) => t - now <= LEAD_MS && now - t <= AFTER_MS)
    .sort((a, b) => a.t - b.t);
  if (high.length === 0) return null;

  // The next release still to come, otherwise the one that just came out.
  const upcoming = high.filter(({ t }) => t > now);
  const focus = upcoming[0] ?? high[high.length - 1];
  if (!focus) return null;
  const sameTime = high.filter(({ t }) => t === focus.t).map(({ e }) => e);
  const left = focus.t - now;
  const released = left <= 0;
  const final = !released && left <= FINAL_MS;
  const main = sameTime[0] ?? focus.e;
  const outcome = main.actual ? marketReaction(main).outcome : null;
  const verdict =
    outcome === "higher"
      ? "Above forecast"
      : outcome === "lower"
        ? "Below forecast"
        : outcome === "inline"
          ? "As expected"
          : null;

  return (
    <section
      aria-live="polite"
      aria-label="High-impact news alert"
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-surface)] border p-4 sm:p-5",
        released
          ? "border-[#f59e0b]/50 bg-[#f59e0b]/10"
          : final
            ? "border-loss/70 bg-loss/15 shadow-[0_0_40px_-10px_var(--pnl-loss)]"
            : "border-[#f59e0b]/50 bg-[#f59e0b]/10",
      )}
    >
      {final && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 animate-pulse bg-loss/10"
        />
      )}
      <div className="relative flex flex-wrap items-center gap-4">
        <span
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
            final ? "bg-loss text-white" : "bg-[#f59e0b] text-black",
          )}
        >
          {final ? (
            <Siren className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Zap className="h-5 w-5" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-xs font-semibold tracking-wide uppercase",
              final ? "text-loss" : "text-[#f59e0b]",
            )}
          >
            {released
              ? "High-impact news just released · expect volatility"
              : final
                ? "High-impact news in less than 5 minutes"
                : "High-impact news coming up"}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 font-semibold">
            <CurrencyFlag currency={main.currency} />
            {main.currency} {main.title}
            {sameTime.length > 1 && (
              <span className="text-sm font-normal text-ink-muted">
                + {sameTime.length - 1} more at the same time
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {main.forecast ? `Forecast ${main.forecast}` : "No forecast"}
            {main.previous ? ` · Previous ${main.previous}` : ""}
            {main.actual ? ` · Actual ${main.actual}` : ""}
          </p>
        </div>
        <div className="text-right">
          {released && main.actual ? (
            <>
              <p className="text-[11px] text-ink-muted">Actual</p>
              <p className="figures pop-text text-4xl font-bold tabular-nums sm:text-5xl">
                {main.actual}
              </p>
              {verdict && (
                <p className="mt-1 inline-block rounded-full bg-coach/20 px-2 py-0.5 text-xs font-semibold text-coach">
                  {verdict}
                </p>
              )}
            </>
          ) : released ? (
            <p className="figures text-sm text-ink-muted" suppressHydrationWarning>
              Waiting for the figure · {Math.max(1, Math.round(-left / 60_000))} min ago
            </p>
          ) : final ? (
            <p
              className="figures pop-text text-4xl font-bold text-loss tabular-nums sm:text-5xl"
              suppressHydrationWarning
            >
              {formatClock(left)}
            </p>
          ) : (
            <p
              className="figures pop-text text-xl font-semibold tabular-nums"
              suppressHydrationWarning
            >
              {formatUntil(left)}
            </p>
          )}
          <Link href="/news" className="text-xs text-ink-muted underline-offset-4 hover:underline">
            Economic calendar
          </Link>
        </div>
      </div>
      <ReactionHint event={main} showWhy className="relative mt-3 border-t border-hi/10 pt-3" />
      <p className="relative mt-2 text-[11px] text-ink-faint">
        Typical first reaction, not a prediction. Spreads widen and price often whipsaws in the
        first minutes. Consider waiting or reducing size.
      </p>
    </section>
  );
}
