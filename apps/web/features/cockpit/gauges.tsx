import {
  type GaugeDto,
  MOOD_LABEL,
  RATING_LABEL,
  RATING_TF_LABEL,
  RATING_TFS,
  RATINGS_DISCLAIMER,
  type RatingDto,
  type RatingTf,
} from "@atc/shared";
import Link from "next/link";
import { cn } from "@/lib/cn";

const LEVEL_TONE = {
  strong_down: "text-loss",
  down: "text-loss",
  neutral: "text-ink-muted",
  up: "text-profit",
  strong_up: "text-profit",
} as const;

/** A half-circle dial from −1 (left) to +1 (right), with the five bands. */
function Dial({ g, title, big = false }: { g: GaugeDto; title: string; big?: boolean }) {
  const W = 200;
  const H = 118;
  const cx = 100;
  const cy = 104;
  const R = 82;
  const point = (score: number, r = R) => {
    const a = Math.PI * (1 - (score + 1) / 2); // −1 → 180°, +1 → 0°
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
  };
  const arc = (from: number, to: number) => {
    const a = point(from);
    const b = point(to);
    return `M ${a.x} ${a.y} A ${R} ${R} 0 0 1 ${b.x} ${b.y}`;
  };
  const bands: Array<[number, number, string]> = [
    [-1, -0.5, "var(--pnl-loss)"],
    [-0.5, -0.1, "color-mix(in srgb, var(--pnl-loss) 55%, transparent)"],
    [-0.1, 0.1, "var(--color-rule)"],
    [0.1, 0.5, "color-mix(in srgb, var(--pnl-profit) 55%, transparent)"],
    [0.5, 1, "var(--pnl-profit)"],
  ];
  const needle = point(g.score, R - 14);
  return (
    <figure
      className={cn(
        "grid justify-items-center gap-1 rounded-[var(--radius-control)] p-3",
        big ? "bg-coach/[0.08] ring-1 ring-coach/30" : "bg-hi/[0.03]",
      )}
    >
      <figcaption className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
        {title}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={big ? "w-56" : "w-44"}
        role="img"
        aria-label={`${title}: ${RATING_LABEL[g.level]}`}
      >
        {bands.map(([a, b, color]) => (
          <path key={a} d={arc(a, b)} stroke={color} strokeWidth={12} fill="none" />
        ))}
        <line
          x1={cx}
          y1={cy}
          x2={needle.x}
          y2={needle.y}
          stroke="var(--color-ink)"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={6} fill="var(--color-ink)" />
        <text x={14} y={H - 2} className="text-[9px]" fill="var(--color-ink-faint)">
          Strong down
        </text>
        <text
          x={W - 14}
          y={H - 2}
          textAnchor="end"
          className="text-[9px]"
          fill="var(--color-ink-faint)"
        >
          Strong up
        </text>
      </svg>
      <p className={cn("text-lg font-semibold", LEVEL_TONE[g.level])}>{RATING_LABEL[g.level]}</p>
      <p className="figures flex gap-4 text-xs">
        <span className="text-loss">Down {g.down}</span>
        <span className="text-ink-muted">Neutral {g.neutral}</span>
        <span className="text-profit">Up {g.up}</span>
      </p>
    </figure>
  );
}

function Readings({ g }: { g: GaugeDto }) {
  return (
    <ul className="figures grid gap-1 text-xs">
      {g.items.map((x) => (
        <li
          key={x.name}
          className="flex justify-between gap-2 border-t border-rule py-1 first:border-0"
        >
          <span className="text-ink-muted">{x.name}</span>
          <span>
            {x.value === null ? "—" : x.value.toLocaleString("en", { maximumFractionDigits: 4 })}{" "}
            <span
              className={cn(
                "ml-1 inline-block w-14 text-right font-semibold",
                x.value === null
                  ? "text-ink-faint"
                  : x.signal === 1
                    ? "text-profit"
                    : x.signal === -1
                      ? "text-loss"
                      : "text-ink-muted",
              )}
            >
              {x.value === null
                ? "n/a"
                : x.signal === 1
                  ? "Up"
                  : x.signal === -1
                    ? "Down"
                    : "Neutral"}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Indicator gauges for one timeframe (tabs for 5m … 1M), with the market mood from ADX and every
 * indicator's reading underneath.
 */
export function IndicatorGauges({
  ratings,
  tf,
  href,
}: {
  ratings: Partial<Record<RatingTf, RatingDto>> | null;
  tf: RatingTf;
  href: (tf: RatingTf) => string;
}) {
  if (!ratings)
    return (
      <p className="text-sm text-ink-muted">
        Indicator gauges cover the 20 most traded coins, gold and silver. They appear within a
        minute or two of the server starting.
      </p>
    );
  const r = ratings[tf];
  return (
    <div className="grid gap-4">
      <nav aria-label="Gauge timeframe" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {RATING_TFS.map((t) => {
          const _x = ratings[t];
          return (
            <Link
              key={t}
              href={href(t)}
              scroll={false}
              aria-current={t === tf ? "page" : undefined}
              className={cn(
                "inline-flex h-8 min-w-12 flex-col items-center justify-center rounded-full border px-3 text-xs whitespace-nowrap",
                t === tf
                  ? "border-coach/60 bg-coach/15 font-semibold text-ink"
                  : "border-rule text-ink-muted hover:bg-hi/[0.06]",
              )}
            >
              <span>{RATING_TF_LABEL[t]}</span>
            </Link>
          );
        })}
      </nav>
      <div className="figures flex flex-wrap gap-2 text-xs">
        {RATING_TFS.map((t) => {
          const x = ratings[t];
          return x ? (
            <span
              key={t}
              className={cn("rounded-full bg-hi/[0.04] px-2 py-0.5", LEVEL_TONE[x.summary.level])}
            >
              {RATING_TF_LABEL[t]} {RATING_LABEL[x.summary.level]}
            </span>
          ) : null;
        })}
      </div>
      {!r ? (
        <p className="text-sm text-ink-muted">This timeframe is being calculated.</p>
      ) : (
        <>
          <p className="text-sm">
            Market mood on {RATING_TF_LABEL[tf]}:{" "}
            <strong
              className={cn(
                r.mood === "trending_up"
                  ? "text-profit"
                  : r.mood === "trending_down"
                    ? "text-loss"
                    : "text-ink",
              )}
            >
              {r.mood ? MOOD_LABEL[r.mood] : "—"}
            </strong>
            {r.adx !== null && (
              <span className="figures text-ink-faint">
                {" "}
                (ADX {r.adx.toFixed(1)}, +DI {r.plusDi?.toFixed(1)}, −DI {r.minusDi?.toFixed(1)})
              </span>
            )}
          </p>
          <div className="grid items-end gap-3 sm:grid-cols-3">
            <Dial g={r.oscillators} title="Oscillators" />
            <Dial g={r.summary} title="Summary" big />
            <Dial g={r.movingAverages} title="Moving averages" />
          </div>
          <details className="rounded-[var(--radius-control)] border border-rule p-3">
            <summary className="cursor-pointer text-sm font-medium">
              All 26 indicators on {RATING_TF_LABEL[tf]}
            </summary>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold text-ink-faint uppercase">Oscillators</p>
                <Readings g={r.oscillators} />
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-ink-faint uppercase">
                  Moving averages
                </p>
                <Readings g={r.movingAverages} />
              </div>
            </div>
          </details>
          <p className="text-xs text-ink-faint">
            {RATINGS_DISCLAIMER} Includes the candle still forming, as on a chart. Market mood: ADX
            25 or more is a trend, below 20 a range.
          </p>
        </>
      )}
    </div>
  );
}
