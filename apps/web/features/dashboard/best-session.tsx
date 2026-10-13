import type { BucketDto } from "@atc/shared";
import { MIN_SESSION_TRADES, sessionVerdict } from "@/features/analytics/session-verdict";
import { formatPercent, formatPnl } from "@/features/trades/format";
import { cn } from "@/lib/cn";

const tone = (v: string) =>
  Number(v) > 0 ? "text-profit" : Number(v) < 0 ? "text-loss" : "text-ink";

/**
 * Answers "which session should I trade?" in one line, then ranks every session the trader has
 * used by net P&L. Sessions with fewer than MIN_SESSION_TRADES trades are shown but marked early,
 * so a lucky handful of trades is never presented as a reliable answer.
 */
export function BestSession({ bySession, timeZone }: { bySession: BucketDto[]; timeZone: string }) {
  const verdict = sessionVerdict(bySession, timeZone);
  const rows = verdict.rows;
  const tz =
    timeZone === "UTC" ? "UTC" : (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
  const leader = rows[0];

  let headline: React.ReactNode;
  let sub: React.ReactNode;
  if (verdict.kind === "none" || !leader) {
    headline = "Your best session appears after your first closed trades.";
    sub = null;
  } else if (verdict.kind === "too-few") {
    const short = rows
      .filter((r) => !r.ranked)
      .map((r) => `${r.label} ${MIN_SESSION_TRADES - r.trades}`)
      .slice(0, 3);
    headline = (
      <>
        Early read: <strong className="text-coach">{leader.label}</strong> is ahead so far.
      </>
    );
    sub = (
      <>
        Not reliable yet. Each session needs {MIN_SESSION_TRADES} trades
        {short.length > 0 && <> (still needed: {short.join(", ")})</>}.
      </>
    );
  } else {
    headline = verdict.bestIsProfitable ? (
      <>
        Trade <strong className="text-profit">{verdict.best.label}</strong>: it's your best session.
      </>
    ) : (
      <>
        No session is profitable yet. You lose least in{" "}
        <strong className="text-coach">{verdict.best.label}</strong>.
      </>
    );
    sub = verdict.worst ? (
      <>
        Trade less in <strong className="text-ink">{verdict.worst.label}</strong>: it cost you{" "}
        <span className="figures text-loss">{formatPnl(verdict.worst.pnl)}</span>.
      </>
    ) : (
      <>
        {verdict.best.localHours} {tz}, {formatPercent(verdict.best.winRate, 0)} of trades won.
      </>
    );
  }

  return (
    <div className="grid content-start gap-4">
      <div>
        <p className="text-base leading-snug font-medium">{headline}</p>
        {sub && <p className="mt-1 text-sm text-ink-muted">{sub}</p>}
      </div>
      {rows.length > 0 && (
        <ol className="grid gap-2">
          {rows.map((r, i) => (
            <li
              key={r.id}
              className={cn(
                "raised grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5",
                i === 0 && r.ranked && Number(r.pnl) > 0 && "ring-1 ring-profit/50",
              )}
            >
              <span
                className={cn(
                  "figures flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_10px_-4px_rgba(0,0,0,0.7)]",
                  i === 0
                    ? "bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-coach)_70%,white),var(--color-coach))] text-coach-ink"
                    : "bg-hi/10 text-ink-muted",
                )}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-x-2 font-medium">
                  {r.label}
                  <span className="figures text-xs font-normal text-ink-faint">{r.localHours}</span>
                  {!r.ranked && (
                    <span className="rounded-full bg-hi/10 px-1.5 py-px text-[10px] font-normal text-ink-muted">
                      early
                    </span>
                  )}
                </span>
                <span className="figures block text-xs text-ink-muted">
                  {r.trades} {r.trades === 1 ? "trade" : "trades"} · {formatPercent(r.winRate, 0)}{" "}
                  won
                </span>
              </span>
              <span className={cn("figures pop-text text-right font-semibold", tone(r.pnl))}>
                {formatPnl(r.pnl)}
                {r.avgPnl && (
                  <span className="block text-[11px] font-normal text-ink-faint">
                    {formatPnl(r.avgPnl)}/trade
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
