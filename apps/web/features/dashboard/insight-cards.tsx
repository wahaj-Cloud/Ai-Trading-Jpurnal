import type { AnalyticsDto, BucketDto, DayDto, MonthDto } from "@atc/shared";
import Link from "next/link";
import { formatPercent, formatPnl, formatPnlCompact, pnlTone } from "@/features/trades/format";
import { cn } from "@/lib/cn";

const TONE = { profit: "text-profit", loss: "text-loss", flat: "text-ink" } as const;

/** Categorical slots, validated for the dark surface (fixed order, never cycled). */
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#9085e9", "#d55181"] as const;
const OTHER = "#5d6f92";

/* ---------------------------------------------------------------- streaks */

export interface DayStreaks {
  current: { kind: "WIN" | "LOSS" | null; length: number };
  bestWin: number;
  worstLoss: number;
}

/** Consecutive green or red trading days (flat days break a run). */
export function dayStreaks(days: DayDto[]): DayStreaks {
  let bestWin = 0;
  let worstLoss = 0;
  let run = 0;
  let kind: "WIN" | "LOSS" | null = null;
  for (const d of days) {
    if (d.trades === 0) continue;
    const pnl = Number(d.pnl);
    const k = pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : null;
    if (k && k === kind) run++;
    else {
      kind = k;
      run = k ? 1 : 0;
    }
    if (kind === "WIN") bestWin = Math.max(bestWin, run);
    if (kind === "LOSS") worstLoss = Math.max(worstLoss, run);
  }
  return { current: { kind, length: run }, bestWin, worstLoss };
}

function StreakBlock({
  title,
  current,
  best,
  worst,
}: {
  title: string;
  current: { kind: "WIN" | "LOSS" | null; length: number };
  best: number;
  worst: number;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-xs text-ink-muted">{title}</p>
      <p
        className={cn(
          "figures pop-text text-3xl font-semibold",
          current.kind === "WIN"
            ? "text-profit"
            : current.kind === "LOSS"
              ? "text-loss"
              : "text-ink",
        )}
      >
        {current.length}
        <span className="ml-1.5 text-sm font-normal text-ink-muted">
          {current.kind === "WIN" ? "winning" : current.kind === "LOSS" ? "losing" : ""}
        </span>
      </p>
      <div className="flex gap-2 text-xs">
        <span className="rounded border border-profit/40 bg-profit/10 px-1.5 py-0.5 text-profit">
          Best {best}
        </span>
        <span className="rounded border border-loss/40 bg-loss/10 px-1.5 py-0.5 text-loss">
          Worst {worst}
        </span>
      </div>
    </div>
  );
}

export function StreakCard({ report }: { report: AnalyticsDto }) {
  const days = dayStreaks(report.daily);
  const s = report.summary;
  return (
    <div className="grid grid-cols-2 gap-4">
      <StreakBlock
        title="Day streak"
        current={days.current}
        best={days.bestWin}
        worst={days.worstLoss}
      />
      <StreakBlock
        title="Trade streak"
        current={s.currentStreak}
        best={s.longestWinStreak}
        worst={s.longestLossStreak}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- symbols donut */

export function SymbolsDonut({ buckets, top = 5 }: { buckets: BucketDto[]; top?: number }) {
  const rows = [...buckets].filter((b) => b.trades > 0).sort((a, b) => b.trades - a.trades);
  const total = rows.reduce((s, b) => s + b.trades, 0);
  const shown = rows.slice(0, top);
  const rest = rows.slice(top);
  const slices = [
    ...shown.map((b, i) => ({
      key: b.key,
      trades: b.trades,
      pnl: b.pnl,
      color: SERIES[i] as string,
    })),
    ...(rest.length
      ? [
          {
            key: `${rest.length} more`,
            trades: rest.reduce((s, b) => s + b.trades, 0),
            pnl: String(rest.reduce((s, b) => s + Number(b.pnl), 0)),
            color: OTHER,
          },
        ]
      : []),
  ];
  const r = 46;
  const c = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 2 : 0;
  let offset = 0;
  if (total === 0) return <p className="text-sm text-ink-muted">No closed trades yet.</p>;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <svg
        viewBox="0 0 120 120"
        className="h-36 w-36 shrink-0 [filter:drop-shadow(0_6px_10px_rgba(0,0,0,0.6))_drop-shadow(0_0_14px_color-mix(in_srgb,var(--color-coach)_18%,transparent))]"
        role="img"
        aria-label={`${rows.length} symbols traded across ${total} trades`}
      >
        <g transform="rotate(-90 60 60)" fill="none" strokeWidth="14">
          {slices.map((sl) => {
            const len = (sl.trades / total) * c;
            const el = (
              <circle
                key={sl.key}
                cx="60"
                cy="60"
                r={r}
                stroke={sl.color}
                strokeDasharray={`${Math.max(len - gap, 0.5)} ${c}`}
                strokeDashoffset={-offset}
              >
                <title>{`${sl.key}: ${sl.trades} trades, ${formatPnl(sl.pnl)}`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
        </g>
        <text
          x="60"
          y="58"
          textAnchor="middle"
          fill="var(--color-ink)"
          fontSize="20"
          fontWeight="600"
        >
          {rows.length}
        </text>
        <text x="60" y="74" textAnchor="middle" fill="var(--color-ink-muted)" fontSize="10">
          symbols
        </text>
      </svg>
      <ul className="grid w-full gap-1.5 text-sm">
        {slices.map((sl) => (
          <li key={sl.key} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: sl.color }}
                aria-hidden="true"
              />
              <span className="truncate">{sl.key.replace(/USDT?$|USDC$/, "")}</span>
              <span className="text-xs text-ink-faint">
                {Math.round((sl.trades / total) * 100)}%
              </span>
            </span>
            <span className={cn("figures text-xs", TONE[pnlTone(sl.pnl)])}>
              {formatPnlCompact(sl.pnl)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------- daily win rate */

export function dayStats(days: DayDto[]) {
  const traded = days.filter((d) => d.trades > 0);
  const green = traded.filter((d) => Number(d.pnl) > 0);
  const red = traded.filter((d) => Number(d.pnl) < 0);
  const avg = (xs: DayDto[]) =>
    xs.length ? xs.reduce((s, d) => s + Number(d.pnl), 0) / xs.length : 0;
  return {
    winRate: traded.length ? green.length / traded.length : null,
    green: green.length,
    red: red.length,
    avgWinDay: avg(green),
    avgLossDay: Math.abs(avg(red)),
  };
}

export function DailyWinCard({ days }: { days: DayDto[] }) {
  const s = dayStats(days);
  const rate = s.winRate ?? 0;
  // Half-circle gauge.
  const r = 50;
  const half = Math.PI * r;
  const ratio = s.avgLossDay > 0 ? s.avgWinDay / s.avgLossDay : null;
  const winShare =
    s.avgWinDay + s.avgLossDay > 0 ? s.avgWinDay / (s.avgWinDay + s.avgLossDay) : 0.5;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="flex flex-col items-center">
        <svg
          viewBox="0 0 120 70"
          className="w-40 [filter:drop-shadow(0_6px_10px_rgba(0,0,0,0.6))_drop-shadow(0_0_14px_color-mix(in_srgb,var(--color-coach)_18%,transparent))]"
          role="img"
          aria-label={`Winning days ${formatPercent(s.winRate, 0)}`}
        >
          <path
            d="M10 62 A50 50 0 0 1 110 62"
            fill="none"
            stroke="var(--pnl-loss)"
            strokeOpacity="0.85"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path
            d="M10 62 A50 50 0 0 1 110 62"
            fill="none"
            stroke="var(--pnl-profit)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(rate * half - 2, 0.01)} ${half}`}
          />
          <text
            x="60"
            y="56"
            textAnchor="middle"
            fill="var(--color-ink)"
            fontSize="18"
            fontWeight="600"
          >
            {formatPercent(s.winRate, 0)}
          </text>
        </svg>
        <p className="mt-1 text-xs text-ink-muted">
          Winning days · <span className="text-profit">{s.green}</span> /{" "}
          <span className="text-loss">{s.red}</span>
        </p>
      </div>
      <div className="grid content-center gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-ink-muted">Avg green day / avg red day</span>
          <span className="figures pop-text text-lg font-semibold">
            {ratio === null ? "—" : ratio.toFixed(2)}
          </span>
        </div>
        <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full" aria-hidden="true">
          <span
            className="pop-bar rounded-l-full bg-profit"
            style={{ width: `${winShare * 100}%` }}
          />
          <span
            className="pop-bar rounded-r-full bg-loss"
            style={{ width: `${(1 - winShare) * 100}%` }}
          />
        </div>
        <div className="flex justify-between text-xs">
          <span className="figures text-profit">{formatPnl(String(s.avgWinDay))}</span>
          <span className="figures text-loss">{formatPnl(String(-s.avgLossDay))}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- hourly wins vs losses */

/** Winning trades rise above the line and losing trades fall below it, for each hour of the day. */
export function HourlyWinsLosses({ buckets }: { buckets: BucketDto[] }) {
  const max = Math.max(...buckets.map((b) => Math.max(b.wins, b.losses)), 1);
  return (
    <figure className="grid gap-2">
      <div
        className="relative grid h-40 grid-cols-24 gap-[2px]"
        style={{ gridTemplateColumns: "repeat(24, minmax(0,1fr))" }}
      >
        <span
          className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-rule"
          aria-hidden="true"
        />
        {buckets.map((b) => (
          <div
            key={b.key}
            className="group relative outline-none"
            role="img"
            aria-label={`${b.key.padStart(2, "0")}:00 — ${b.wins} wins, ${b.losses} losses, ${formatPnl(b.pnl)}`}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: focus reveals the exact figures for keyboard users
            tabIndex={0}
          >
            <span
              className="absolute inset-x-[15%] bottom-1/2 pop-bar rounded-t-[4px] bg-coach group-hover:brightness-125"
              style={{ height: `${(b.wins / max) * 50}%` }}
            />
            <span
              className="absolute inset-x-[15%] top-1/2 pop-bar rounded-b-[4px] bg-[#d95926] group-hover:brightness-125"
              style={{ height: `${(b.losses / max) * 50}%` }}
            />
            <div
              aria-hidden="true"
              className="pop pointer-events-none absolute bottom-[calc(50%+0.5rem)] left-1/2 z-10 hidden w-max -translate-x-1/2 rounded-[var(--radius-control)] px-3 py-2 text-xs group-hover:block group-focus-visible:block"
            >
              <p className="font-medium">{b.key.padStart(2, "0")}:00</p>
              <p className="figures">
                <span className="text-coach">{b.wins} won</span> ·{" "}
                <span className="text-[#f07a45]">{b.losses} lost</span>
              </p>
              <p className={cn("figures pop-text font-semibold", TONE[pnlTone(b.pnl)])}>
                {formatPnl(b.pnl)}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div
        className="grid text-center text-[10px] text-ink-faint"
        style={{ gridTemplateColumns: "repeat(24, minmax(0,1fr))" }}
        aria-hidden="true"
      >
        {buckets.map((b, i) => (
          <span key={b.key} className={cn(i % 3 !== 0 && "invisible")}>
            {b.key.padStart(2, "0")}
          </span>
        ))}
      </div>
      <figcaption className="flex gap-4 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-coach" aria-hidden="true" /> Winning trades
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-[#d95926]" aria-hidden="true" /> Losing trades
        </span>
        <span className="text-ink-faint">by the hour you opened</span>
      </figcaption>
    </figure>
  );
}

/* ---------------------------------------------------------------- yearly grid */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function YearlyGrid({ months }: { months: MonthDto[] }) {
  const byKey = new Map(months.map((m) => [m.month, m]));
  const years = [...new Set(months.map((m) => m.month.slice(0, 4)))].sort().reverse();
  if (years.length === 0) return <p className="text-sm text-ink-muted">No closed trades yet.</p>;
  return (
    <div className="grid gap-3 overflow-x-auto">
      {years.map((y) => {
        const yearTotal = months.filter((m) => m.month.startsWith(y));
        const pnl = yearTotal.reduce((s, m) => s + Number(m.pnl), 0);
        const trades = yearTotal.reduce((s, m) => s + m.trades, 0);
        return (
          <div
            key={y}
            className="grid min-w-[44rem] grid-cols-[3rem_repeat(12,minmax(0,1fr))_5rem] items-stretch gap-1.5"
          >
            <span className="self-center text-sm font-medium text-ink-muted">{y}</span>
            {MONTHS.map((label, i) => {
              const m = byKey.get(`${y}-${String(i + 1).padStart(2, "0")}`);
              const v = Number(m?.pnl ?? 0);
              const key = `${y}-${String(i + 1).padStart(2, "0")}`;
              const cls = cn(
                "rounded-[10px] border px-1.5 py-1.5 text-center",
                !m
                  ? "border-rule/60 bg-raised/30"
                  : cn(
                      "lift shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_8px_16px_-8px_rgba(0,0,0,0.7)] hover:brightness-125",
                      v >= 0 ? "border-profit/50 bg-profit/10" : "border-loss/50 bg-loss/10",
                    ),
              );
              const body = (
                <>
                  <p className="text-[10px] text-ink-faint">{label}</p>
                  <p
                    className={cn(
                      "figures text-xs font-semibold",
                      m ? TONE[pnlTone(m.pnl)] : "text-ink-faint",
                    )}
                  >
                    {m ? formatPnlCompact(m.pnl) : "—"}
                  </p>
                  {m && <p className="text-[10px] text-ink-faint">{m.trades} tr</p>}
                </>
              );
              // Months with trades open their full month page.
              return m ? (
                <Link
                  key={label}
                  href={`/months/${key}`}
                  className={cls}
                  aria-label={`${label} ${y}: ${formatPnl(m.pnl)} over ${m.trades} trades. Open month`}
                >
                  {body}
                </Link>
              ) : (
                <div key={label} className={cls} title={`${label} ${y}: no trades`}>
                  {body}
                </div>
              );
            })}
            <div className="raised rounded-[10px] px-1.5 py-1.5 text-center">
              <p className="text-[10px] text-ink-faint">Year</p>
              <p
                className={cn(
                  "figures text-xs font-semibold",
                  pnl > 0 ? "text-profit" : pnl < 0 ? "text-loss" : "text-ink",
                )}
              >
                {formatPnlCompact(String(pnl))}
              </p>
              <p className="text-[10px] text-ink-faint">{trades} tr</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
