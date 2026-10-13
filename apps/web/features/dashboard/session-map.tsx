import { type BucketDto, SESSIONS, type SessionId } from "@atc/shared";
import {
  localHour,
  localSegments,
  MIN_SESSION_TRADES,
  offsetMinutes,
  sessionVerdict,
  UTC_END,
  UTC_START,
} from "@/features/analytics/session-verdict";
import { PnlColumns } from "@/features/charts/pnl-columns";
import { formatPercent, formatPnl, pnlTone } from "@/features/trades/format";
import { cn } from "@/lib/cn";

const TONE = { profit: "text-profit", loss: "text-loss", flat: "text-ink" } as const;
const ORDER: SessionId[] = ["ASIA", "LONDON", "NEW_YORK", "OFF_HOURS"];
/**
 * The trading-session view: a plain verdict, one tile per session, and the 24 hours of the trader's
 * own day with the session windows marked under the hourly P&L columns.
 */
export function SessionMap({
  bySession,
  byHour,
  timeZone,
}: {
  bySession: BucketDto[];
  byHour: BucketDto[];
  timeZone: string;
}) {
  const today = new Date();
  const verdict = sessionVerdict(bySession, timeZone, today);
  const offset = offsetMinutes(timeZone, today);
  const tz =
    timeZone === "UTC" ? "UTC" : (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
  const byId = new Map(bySession.map((b) => [b.key, b]));
  const best = verdict.kind === "ranked" && verdict.bestIsProfitable ? verdict.best.id : null;
  const worst = verdict.kind === "ranked" ? (verdict.worst?.id ?? null) : null;

  return (
    <div className="grid gap-6">
      {verdict.kind === "ranked" ? (
        <p className="text-base">
          {verdict.bestIsProfitable
            ? "You trade best in "
            : "No session is profitable yet; you lose least in "}
          <strong className="font-semibold">{verdict.best.label}</strong>{" "}
          <span className="text-ink-muted">
            ({verdict.best.localHours} {tz})
          </span>
          {verdict.worst && (
            <>
              . <strong className="font-semibold">{verdict.worst.label}</strong> costs you{" "}
              <span className="figures font-semibold text-loss">
                {formatPnl(verdict.worst.pnl)}
              </span>
            </>
          )}
          .
        </p>
      ) : (
        <p className="text-sm text-ink-muted">
          Each session needs {MIN_SESSION_TRADES} closed trades before we rank it.
        </p>
      )}

      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ORDER.map((id) => {
          const b = byId.get(id);
          const trades = b?.trades ?? 0;
          const pnl = b?.pnl ?? "0";
          const wins = b?.wins ?? 0;
          const losses = b?.losses ?? 0;
          const decided = wins + losses;
          const hours = `${localHour(UTC_START[id], timeZone, today)}–${localHour(UTC_END[id], timeZone, today)}`;
          const tone = pnlTone(trades ? pnl : null);
          return (
            <li
              key={id}
              className={cn(
                "raised lift relative overflow-hidden rounded-[var(--radius-control)] p-4",
                id === best && "border-profit/60",
                id === worst && "border-loss/60",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-y-0 left-0 w-1",
                  tone === "profit" ? "bg-profit" : tone === "loss" ? "bg-loss" : "bg-rule",
                )}
              />
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{SESSIONS[id].label}</p>
                  <p className="figures text-xs text-ink-muted">
                    {hours} {tz}
                  </p>
                </div>
                {id === best && (
                  <span className="rounded bg-profit/15 px-1.5 py-0.5 text-xs text-profit">
                    Best
                  </span>
                )}
                {id === worst && (
                  <span className="rounded bg-loss/15 px-1.5 py-0.5 text-xs text-loss">Worst</span>
                )}
              </div>
              <p
                className={cn(
                  "figures pop-text mt-3 text-2xl font-semibold",
                  trades ? TONE[tone] : "text-ink-faint",
                )}
              >
                {trades ? formatPnl(pnl) : "—"}
              </p>
              <div className="mt-3">
                <div
                  className="flex h-1.5 gap-[2px] overflow-hidden rounded-full"
                  role="img"
                  aria-label={`${wins} wins, ${losses} losses`}
                >
                  {decided > 0 ? (
                    <>
                      <span
                        className="pop-bar rounded-l-full bg-profit"
                        style={{ width: `${(wins / decided) * 100}%` }}
                      />
                      <span
                        className="pop-bar rounded-r-full bg-loss"
                        style={{ width: `${(losses / decided) * 100}%` }}
                      />
                    </>
                  ) : (
                    <span className="w-full rounded-full bg-rule" />
                  )}
                </div>
                <p className="mt-1.5 flex justify-between text-xs text-ink-muted">
                  <span>{trades} trades</span>
                  <span>
                    {b?.winRate === null || !b ? "—" : `${formatPercent(b.winRate, 0)} won`}
                  </span>
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="grid gap-2">
        <PnlColumns
          title={`Your day, hour by hour (${tz} time, by when you opened)`}
          buckets={byHour}
          label={(k) => `${k.padStart(2, "0")}:00`}
          height={140}
        />
        <div
          className="relative h-6 rounded-[4px] bg-raised/40"
          role="img"
          aria-label="Session windows on your local clock"
        >
          {ORDER.flatMap((id) =>
            localSegments(id, offset).map(([a, b]) => (
              <div
                key={`${id}-${a}`}
                className={cn(
                  "absolute inset-y-0 flex items-center justify-center overflow-hidden border-x border-canvas text-[11px]",
                  id === best
                    ? "bg-profit/20 text-ink"
                    : id === worst
                      ? "bg-loss/20 text-ink"
                      : "bg-raised text-ink-muted",
                )}
                style={{ left: `${(a / 1440) * 100}%`, width: `${((b - a) / 1440) * 100}%` }}
                title={`${SESSIONS[id].label} session`}
              >
                <span className="truncate px-1">{SESSIONS[id].label}</span>
              </div>
            )),
          )}
        </div>
      </div>
    </div>
  );
}
