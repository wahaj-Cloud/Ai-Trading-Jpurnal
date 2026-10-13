import type { BucketDto, SummaryDto } from "@atc/shared";
import {
  formatPercent,
  formatPnl,
  formatPnlCompact,
  formatRatio,
  pnlTone,
} from "@/features/trades/format";
import { cn } from "@/lib/cn";

const TONE = { profit: "text-profit", loss: "text-loss", flat: "text-ink" } as const;

/**
 * Win-rate ring: wins and losses as two arcs with a 2px gap, the rate printed in the middle so the
 * number never depends on reading the arc.
 */
function WinRing({ wins, losses, rate }: { wins: number; losses: number; rate: number | null }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const total = wins + losses;
  const gap = total > 0 && wins > 0 && losses > 0 ? 3 : 0;
  const winLen = total ? (wins / total) * c : 0;
  const lossLen = total ? (losses / total) * c : 0;
  return (
    <svg
      viewBox="0 0 128 128"
      className="h-32 w-32 shrink-0 [filter:drop-shadow(0_6px_10px_rgba(0,0,0,0.6))_drop-shadow(0_0_14px_rgba(77,148,255,0.18))]"
      role="img"
      aria-label={`Win rate ${formatPercent(rate, 0)}: ${wins} wins, ${losses} losses`}
    >
      <circle cx="64" cy="64" r={r} fill="none" stroke="var(--color-rule)" strokeWidth="10" />
      {total > 0 && (
        <g transform="rotate(-90 64 64)" strokeWidth="10" fill="none" strokeLinecap="round">
          {wins > 0 && (
            <circle
              cx="64"
              cy="64"
              r={r}
              stroke="var(--pnl-profit)"
              strokeDasharray={`${Math.max(winLen - gap, 0.01)} ${c}`}
            />
          )}
          {losses > 0 && (
            <circle
              cx="64"
              cy="64"
              r={r}
              stroke="var(--pnl-loss)"
              strokeDasharray={`${Math.max(lossLen - gap, 0.01)} ${c}`}
              strokeDashoffset={-winLen}
            />
          )}
        </g>
      )}
      <text
        x="64"
        y="62"
        textAnchor="middle"
        className="figures"
        fill="var(--color-ink)"
        fontSize="22"
        fontWeight="600"
      >
        {formatPercent(rate, 0)}
      </text>
      <text x="64" y="80" textAnchor="middle" fill="var(--color-ink-muted)" fontSize="11">
        win rate
      </text>
    </svg>
  );
}

/** Two magnitudes on one shared scale: average win against average loss. */
function PairBar({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: "profit" | "loss";
}) {
  const w = max > 0 ? Math.max((value / max) * 100, 2) : 0;
  return (
    <div className="grid gap-1">
      <div className="flex justify-between text-xs">
        <span className="text-ink-muted">{label}</span>
        <span className="figures text-ink">
          {formatPnl(String(tone === "loss" ? -value : value))}
        </span>
      </div>
      <div className="h-2 rounded-full bg-rule/50">
        <div
          className={cn("pop-bar h-2 rounded-full", tone === "profit" ? "bg-profit" : "bg-loss")}
          style={{ width: `${w}%` }}
        />
      </div>
    </div>
  );
}

export function WinLossPanel({ s }: { s: SummaryDto }) {
  const avgWin = Number(s.avgWin ?? 0);
  const avgLoss = Number(s.avgLoss ?? 0);
  const max = Math.max(avgWin, avgLoss);
  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-5">
        <WinRing wins={s.wins} losses={s.losses} rate={s.winRate} />
        <dl className="grid flex-1 gap-3 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-ink-muted">Wins / losses</dt>
            <dd className="figures">
              <span className="text-profit">{s.wins}</span> /{" "}
              <span className="text-loss">{s.losses}</span>
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink-muted">Profit factor</dt>
            <dd className="figures">{formatRatio(s.profitFactor)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink-muted">Reward : risk</dt>
            <dd className="figures">{formatRatio(s.payoffRatio)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink-muted">Max drawdown</dt>
            <dd className="figures text-loss">{formatPnl(`-${s.maxDrawdown}`)}</dd>
          </div>
        </dl>
      </div>
      <div className="grid gap-3">
        <PairBar label="Average win" value={avgWin} max={max} tone="profit" />
        <PairBar label="Average loss" value={avgLoss} max={max} tone="loss" />
      </div>
      <dl className="grid grid-cols-2 gap-3 border-t border-rule pt-4 text-sm">
        <div>
          <dt className="text-xs text-ink-muted">Largest win</dt>
          <dd className="figures font-semibold text-profit">{formatPnl(s.largestWin)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Largest loss</dt>
          <dd className="figures font-semibold text-loss">{formatPnl(s.largestLoss)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Current streak</dt>
          <dd className="figures font-semibold">
            {s.currentStreak.kind
              ? `${s.currentStreak.length} ${s.currentStreak.kind === "WIN" ? (s.currentStreak.length === 1 ? "win" : "wins") : s.currentStreak.length === 1 ? "loss" : "losses"}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Profitable days</dt>
          <dd className="figures font-semibold">
            {s.profitableDays} / {s.tradingDays}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Diverging horizontal bars around a centre line: profitable coins extend right, losing coins left,
 * on one scale. Each row names the coin and prints the amount, so colour is never the only cue.
 */
export function CoinBars({ buckets, limit = 7 }: { buckets: BucketDto[]; limit?: number }) {
  const rows = [...buckets]
    .filter((b) => b.trades > 0)
    .sort((a, b) => Math.abs(Number(b.pnl)) - Math.abs(Number(a.pnl)))
    .slice(0, limit)
    .sort((a, b) => Number(b.pnl) - Number(a.pnl));
  const max = Math.max(...rows.map((b) => Math.abs(Number(b.pnl))), 0);
  if (rows.length === 0) return <p className="text-sm text-ink-muted">No closed trades yet.</p>;
  return (
    <ul className="grid gap-2.5">
      {rows.map((b) => {
        const v = Number(b.pnl);
        const share = max ? (Math.abs(v) / max) * 50 : 0;
        return (
          <li
            key={b.key}
            className="grid grid-cols-[5.5rem_1fr_5.5rem] items-center gap-3 text-sm"
            title={`${b.key}: ${formatPnl(b.pnl)} over ${b.trades} trades, ${formatPercent(b.winRate, 0)} won`}
          >
            <span className="truncate font-medium">{b.key.replace(/USDT?$|USDC$/, "")}</span>
            <div className="relative h-3">
              <span className="absolute inset-y-[-3px] left-1/2 w-px bg-rule" aria-hidden="true" />
              <span
                className={cn(
                  "absolute inset-y-0",
                  v >= 0
                    ? "pop-bar left-1/2 rounded-r-[5px] bg-profit"
                    : "pop-bar right-1/2 rounded-l-[5px] bg-loss",
                )}
                style={{ width: `${Math.max(share, 0.6)}%` }}
              />
            </div>
            <span className={cn("figures text-right", TONE[pnlTone(b.pnl)])}>
              {formatPnlCompact(b.pnl)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Long against short: trades, win rate and net result side by side. */
export function DirectionSplit({ buckets }: { buckets: BucketDto[] }) {
  const get = (k: string) => buckets.find((b) => b.key === k);
  const long = get("LONG");
  const short = get("SHORT");
  const total = (long?.trades ?? 0) + (short?.trades ?? 0);
  const longShare = total ? ((long?.trades ?? 0) / total) * 100 : 50;
  return (
    <div className="grid gap-4">
      <div>
        <div className="flex h-2 gap-[2px] overflow-hidden rounded-full" aria-hidden="true">
          <span className="rounded-l-full bg-ink/70" style={{ width: `${longShare}%` }} />
          <span
            className="rounded-r-full bg-ink-faint/60"
            style={{ width: `${100 - longShare}%` }}
          />
        </div>
        <p className="mt-1.5 flex justify-between text-xs text-ink-muted">
          <span>{Math.round(longShare)}% long</span>
          <span>{Math.round(100 - longShare)}% short</span>
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        {[
          ["Long", long],
          ["Short", short],
        ].map(([label, b]) => {
          const bucket = b as BucketDto | undefined;
          return (
            <div
              key={label as string}
              className="rounded-[var(--radius-control)] border border-rule bg-raised/50 p-3"
            >
              <dt className="text-xs text-ink-muted">{label as string}</dt>
              <dd
                className={cn(
                  "figures mt-1 text-lg font-semibold",
                  bucket?.trades ? TONE[pnlTone(bucket.pnl)] : "text-ink-faint",
                )}
              >
                {bucket?.trades ? formatPnl(bucket.pnl) : "—"}
              </dd>
              <dd className="text-xs text-ink-faint">
                {bucket?.trades ?? 0} trades · {formatPercent(bucket?.winRate ?? null, 0)} won
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
