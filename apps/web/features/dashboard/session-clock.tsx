"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { formatCountdown, MARKETS, marketStatus, wallClock } from "./market-hours";

/** Minutes the timezone is ahead of UTC at this instant, in [-720, 840]. */
function offsetOf(at: Date, timeZone: string): number {
  const utc = at.getUTCHours() * 60 + at.getUTCMinutes();
  let d = wallClock(at, timeZone).minutes - utc;
  if (d < -720) d += 1440;
  if (d > 840) d -= 1440;
  return d;
}

function segments(start: number, end: number): Array<[number, number]> {
  const s = ((start % 1440) + 1440) % 1440;
  const len = end - start;
  return s + len <= 1440
    ? [[s, s + len]]
    : [
        [s, 1440],
        [0, s + len - 1440],
      ];
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Live clock of the four major trading centres: which are open now, when the next one opens, and
 * where each sits on the trader's own 24-hour day.
 */
export function SessionClock({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!now) return <div className="h-64" aria-hidden="true" />;

  const local = wallClock(now, timeZone);
  const viewerOffset = offsetOf(now, timeZone);
  const statuses = MARKETS.map((m) => marketStatus(m, now));
  const next = statuses
    .filter((s) => !s.open)
    .sort((a, b) => a.minutesToChange - b.minutesToChange)[0];
  const tz =
    timeZone === "UTC" ? "UTC" : (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
  const nowPct = (local.minutes / 1440) * 100;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_15rem]">
      <div className="grid gap-5">
        <div>
          <p className="figures flex items-center gap-1.5 text-4xl font-semibold tracking-tight sm:gap-2 sm:text-5xl">
            <span className="sr-only">
              {pad(now.getUTCHours())}:{pad(now.getUTCMinutes())} UTC
            </span>
            {[now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()].map((n, i) => (
              <span key={["h", "m", "s"][i]} className="flex items-center gap-1.5 sm:gap-2">
                {i > 0 && (
                  <span className="pop-text pb-1 text-ink-faint" aria-hidden="true">
                    :
                  </span>
                )}
                <span
                  aria-hidden="true"
                  className="raised glow-text relative rounded-[14px] px-2.5 py-1.5 sm:px-3 sm:py-2"
                >
                  {/* Flip-clock seam across the middle of each tile. */}
                  <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-black/35 shadow-[0_1px_0_rgba(255,255,255,0.08)]" />
                  {pad(n)}
                </span>
              </span>
            ))}
            <span className="pop-text ml-1 text-xl text-ink-muted sm:text-2xl" aria-hidden="true">
              UTC
            </span>
          </p>
          <p className="figures mt-3 text-sm text-ink-muted">
            Your time {pad(Math.floor(local.minutes / 60))}:{pad(local.minutes % 60)} · {tz}
          </p>
        </div>

        <div className="grid gap-2">
          {MARKETS.map((m, i) => {
            const status = statuses[i];
            const mOffset = offsetOf(now, m.timeZone);
            const start = m.open - mOffset + viewerOffset;
            return (
              <div key={m.id} className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
                <span className="text-xs text-ink-muted">{m.label}</span>
                <div className="relative h-5 rounded-full bg-black/25 shadow-[inset_0_2px_4px_rgba(0,0,0,0.5),0_1px_0_rgba(255,255,255,0.06)]">
                  {segments(start, start + (m.close - m.open)).map(([a, b]) => (
                    <span
                      key={a}
                      className={cn(
                        "pop-bar absolute inset-y-0 rounded-full",
                        status?.open
                          ? "bg-coach shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_0_18px_-2px_rgba(77,148,255,0.9)]"
                          : "bg-coach/35",
                      )}
                      style={{ left: `${(a / 1440) * 100}%`, width: `${((b - a) / 1440) * 100}%` }}
                    />
                  ))}
                  <span
                    className="absolute inset-y-[-4px] w-0.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]"
                    style={{ left: `${nowPct}%` }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            );
          })}
          <div
            className="grid grid-cols-[5.5rem_1fr] gap-3 text-[11px] text-ink-faint"
            aria-hidden="true"
          >
            <span />
            <div className="flex justify-between">
              {["00", "06", "12", "18", "24"].map((h) => (
                <span key={h}>{h}:00</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="raised grid content-start gap-2 rounded-[var(--radius-control)] p-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">Markets</p>
        <ul className="grid gap-1.5">
          {statuses.map((s) => (
            <li key={s.market.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    s.open ? "bg-profit shadow-[0_0_8px_var(--pnl-profit)]" : "bg-ink-faint",
                  )}
                  aria-hidden="true"
                />
                <span>
                  {s.market.label}
                  <span className="figures block text-xs text-ink-faint">{s.localTime}</span>
                </span>
              </span>
              {s.open ? (
                <span className="rounded-full border border-profit/50 bg-profit/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-profit shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_12px_-2px_var(--pnl-profit)]">
                  LIVE · {formatCountdown(s.minutesToChange)}
                </span>
              ) : (
                <span className="figures text-xs text-ink-faint">
                  opens {formatCountdown(s.minutesToChange)}
                </span>
              )}
            </li>
          ))}
        </ul>
        {next && (
          <p className="mt-1 border-t border-rule pt-2 text-xs text-ink-muted">
            Next: {next.market.label} in {formatCountdown(next.minutesToChange)}
          </p>
        )}
      </div>
    </div>
  );
}
