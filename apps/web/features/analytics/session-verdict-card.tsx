import type { BucketDto } from "@atc/shared";
import { formatPnl, pnlTone } from "@/features/trades/format";
import { cn } from "@/lib/cn";
import { MIN_SESSION_TRADES, sessionVerdict } from "./session-verdict";

const TONE = { profit: "text-profit", loss: "text-loss", flat: "text-ink" } as const;
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

/** A plain answer to "which session should I trade?", with the numbers behind it. */
export function SessionVerdictCard({
  buckets,
  timeZone,
  compact = false,
}: {
  buckets: readonly BucketDto[];
  timeZone: string;
  compact?: boolean;
}) {
  const v = sessionVerdict(buckets, timeZone);
  const tzLabel = timeZone === "UTC" ? "UTC" : timeZone.split("/").pop()?.replace(/_/g, " ");

  if (v.kind === "none") {
    return (
      <p className="text-sm text-ink-muted">
        Your best and worst trading session appears here once you have closed trades.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      {v.kind === "too-few" ? (
        <p className="text-sm text-ink-muted">
          Not enough trades yet to compare sessions fairly. Each session needs at least{" "}
          {MIN_SESSION_TRADES} closed trades.
        </p>
      ) : (
        <div className="grid gap-2">
          <p className="text-base">
            {v.bestIsProfitable ? "Your best session is " : "No session is profitable yet. "}
            {!v.bestIsProfitable && "You lose least in "}
            <strong className="font-semibold">{v.best.label}</strong>{" "}
            <span className="text-ink-muted">
              ({v.best.localHours} {tzLabel})
            </span>
            :{" "}
            <span className={cn("figures font-semibold", TONE[pnlTone(v.best.pnl)])}>
              {formatPnl(v.best.pnl)}
            </span>{" "}
            over {v.best.trades} trades, {pct(v.best.winRate)} won.
          </p>
          {v.worst && (
            <p className="text-sm text-ink-muted">
              <strong className="font-semibold text-ink">{v.worst.label}</strong> (
              {v.worst.localHours}) costs you{" "}
              <span className="figures font-semibold text-loss">{formatPnl(v.worst.pnl)}</span> over{" "}
              {v.worst.trades} trades. Consider trading less, or smaller, in that window.
            </p>
          )}
        </div>
      )}

      {!compact && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead className="text-left text-xs text-ink-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Session</th>
                <th className="py-2 pr-3 font-medium">Your time ({tzLabel})</th>
                <th className="py-2 pr-3 text-right font-medium">Trades</th>
                <th className="py-2 pr-3 text-right font-medium">Win rate</th>
                <th className="py-2 pr-3 text-right font-medium">Avg</th>
                <th className="py-2 text-right font-medium">Net P&amp;L</th>
              </tr>
            </thead>
            <tbody className="figures">
              {v.rows.map((r) => (
                <tr key={r.id} className="border-t border-rule">
                  <td className="py-2 pr-3 font-sans">
                    {r.label}
                    {v.kind === "ranked" && r.id === v.best.id && v.bestIsProfitable && (
                      <span className="ml-2 rounded bg-profit/15 px-1.5 py-0.5 text-xs text-profit">
                        Best
                      </span>
                    )}
                    {v.kind === "ranked" && r.id === v.worst?.id && (
                      <span className="ml-2 rounded bg-loss/15 px-1.5 py-0.5 text-xs text-loss">
                        Worst
                      </span>
                    )}
                    {!r.ranked && <span className="ml-2 text-xs text-ink-faint">few trades</span>}
                  </td>
                  <td className="py-2 pr-3">{r.localHours}</td>
                  <td className="py-2 pr-3 text-right">{r.trades}</td>
                  <td className="py-2 pr-3 text-right">{pct(r.winRate)}</td>
                  <td className={cn("py-2 pr-3 text-right", TONE[pnlTone(r.avgPnl)])}>
                    {formatPnl(r.avgPnl)}
                  </td>
                  <td className={cn("py-2 text-right font-semibold", TONE[pnlTone(r.pnl)])}>
                    {formatPnl(r.pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
