import {
  ALIGN_WINDOWS,
  ALIGNMENT_TEXT,
  alignmentOf,
  BREADTH_LEAD,
  DIVERGENCE_INFO,
  divergenceOf,
  type FlowAlignment,
  fundingStateOf,
  isPinned,
  type MarketRead,
  ORDERFLOW_WINDOW_LABEL,
  ORDERFLOW_WINDOWS,
  type OrderflowAcross,
  type OrderflowCoinDto,
  type OrderflowWindow,
  REGIME_INFO,
  type ReadPoint,
  type ReadTone,
  type Regime,
  relVolumeText,
  STRENGTH_LABEL,
  STRENGTH_THRESHOLDS,
  signedPct,
  UNUSUAL_VOLUME,
} from "@atc/shared";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Flame,
  Info,
  Layers,
  type LucideIcon,
  Magnet,
  Minus,
  Scale,
  TriangleAlert,
  Zap,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { coinName, pct, usd } from "./format";
import { STRENGTH_STYLE } from "./strength";

export const TONE_TEXT: Record<ReadTone, string> = {
  up: "text-profit",
  down: "text-loss",
  neutral: "text-ink-muted",
  warn: "text-[#f59e0b]",
};
const TONE_ICON: Record<ReadTone, LucideIcon> = {
  up: ArrowUp,
  down: ArrowDown,
  neutral: Minus,
  warn: TriangleAlert,
};
const fundingPct = (f: number) => signedPct(f * 100, 4);

/** Section title with a small label above and a one-line "what this tells you" underneath. */
export function SectionHead({
  eyebrow,
  title,
  tells,
  action,
  id,
}: {
  eyebrow: string;
  title: string;
  tells: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="grid gap-1">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-coach uppercase">
          {eyebrow}
        </p>
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <p className="flex max-w-3xl items-start gap-1.5 text-sm text-ink-muted">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-coach" />
          <span>{tells}</span>
        </p>
      </div>
      {action}
    </div>
  );
}

/** Plain-language sentences, each with an arrow or warning mark in its colour. */
export function ReadList({ points, className }: { points: ReadPoint[]; className?: string }) {
  return (
    <ul className={cn("grid gap-2 text-sm", className)}>
      {points.map((p) => {
        const Icon = TONE_ICON[p.tone];
        return (
          <li key={p.text} className="flex items-start gap-2.5">
            <span
              className={cn(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-hi/[0.06]",
                TONE_TEXT[p.tone],
              )}
            >
              <Icon aria-hidden="true" className="size-3.5" />
              <span className="sr-only">
                {p.tone === "warn" ? "Note" : p.tone === "neutral" ? "Info" : p.tone}
              </span>
            </span>
            <span className="text-ink">{p.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** A half-circle meter of the share of coins with net market buying (0% left, 100% right). */
function BreadthDial({ breadth, lean }: { breadth: number | null; lean: MarketRead["lean"] }) {
  const W = 240;
  const H = 146;
  const cx = 120;
  const cy = 122;
  const R = 100;
  const at = (v: number, r = R) => {
    const a = Math.PI * (1 - v / 100);
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
  };
  const arc = (from: number, to: number) => {
    const a = at(from);
    const b = at(to);
    return `M ${a.x} ${a.y} A ${R} ${R} 0 0 1 ${b.x} ${b.y}`;
  };
  const lo = 100 - BREADTH_LEAD;
  const ticks = Array.from({ length: 21 }, (_, i) => i * 5);
  const needle = breadth === null ? null : at(breadth, R - 18);
  return (
    <figure className="grid justify-items-center gap-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-[17rem]"
        role="img"
        aria-label={
          breadth === null
            ? "No coins traded"
            : `${Math.round(breadth)}% of coins had net market buying`
        }
      >
        <defs>
          <linearGradient id="breadth-g" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="var(--pnl-loss)" />
            <stop offset="40%" stopColor="color-mix(in srgb, var(--pnl-loss) 35%, transparent)" />
            <stop offset="50%" stopColor="var(--color-rule)" />
            <stop offset="60%" stopColor="color-mix(in srgb, var(--pnl-profit) 35%, transparent)" />
            <stop offset="100%" stopColor="var(--pnl-profit)" />
          </linearGradient>
          <filter id="breadth-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <path d={arc(0, 100)} stroke="var(--color-well)" strokeWidth={18} fill="none" />
        <path
          d={arc(0, 100)}
          stroke="url(#breadth-g)"
          strokeWidth={14}
          fill="none"
          strokeLinecap="round"
        />
        {ticks.map((t) => {
          const a = at(t, R - 12);
          const b = at(t, R - (t % 25 === 0 ? 22 : 17));
          return (
            <line
              key={t}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--color-ink-faint)"
              strokeWidth={t === lo || t === BREADTH_LEAD ? 2 : 1}
              opacity={t === lo || t === BREADTH_LEAD ? 0.9 : 0.4}
            />
          );
        })}
        {needle && (
          <>
            <line
              x1={cx}
              y1={cy}
              x2={needle.x}
              y2={needle.y}
              stroke="var(--color-glow)"
              strokeWidth={6}
              strokeLinecap="round"
              filter="url(#breadth-glow)"
              opacity={0.6}
            />
            <line
              x1={cx}
              y1={cy}
              x2={needle.x}
              y2={needle.y}
              stroke="var(--color-ink)"
              strokeWidth={3}
              strokeLinecap="round"
            />
          </>
        )}
        <circle cx={cx} cy={cy} r={7} fill="var(--color-ink)" />
        <text x={14} y={H - 2} className="text-[10px]" fill="var(--color-ink-faint)">
          All selling
        </text>
        <text
          x={W - 14}
          y={H - 2}
          textAnchor="end"
          className="text-[10px]"
          fill="var(--color-ink-faint)"
        >
          All buying
        </text>
      </svg>
      <p
        className={cn(
          "figures pop-text text-4xl font-semibold",
          lean === "up" ? "text-profit" : lean === "down" ? "text-loss" : "text-ink",
        )}
      >
        {breadth === null ? "—" : `${Math.round(breadth)}%`}
      </p>
      <figcaption className="text-center text-xs text-ink-faint">
        of coins with more market buying than selling
        <br />
        Below {lo}% sellers lead · above {BREADTH_LEAD}% buyers lead
      </figcaption>
    </figure>
  );
}

function Tile({
  label,
  value,
  tone,
  note,
  children,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  note: string;
  children?: ReactNode;
}) {
  return (
    <div className="raised grid content-start gap-1 rounded-[var(--radius-control)] p-3.5">
      <p className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">{label}</p>
      <p className={cn("figures text-xl font-semibold", tone)}>{value}</p>
      {children}
      <p className="text-xs leading-snug text-ink-faint">{note}</p>
    </div>
  );
}

/** The top panel: the meter, the plain-language read and the four headline numbers. */
export function MarketReadPanel({
  read,
  window,
  buying,
  selling,
  netFlowUsd,
}: {
  read: MarketRead;
  window: OrderflowWindow;
  buying: number;
  selling: number;
  netFlowUsd: number;
}) {
  const label = ORDERFLOW_WINDOW_LABEL[window];
  const moving = read.opening + read.closing;
  return (
    <section
      aria-labelledby="market-read"
      className="surface hud grid gap-6 rounded-[var(--radius-surface)] p-5 sm:p-6 lg:grid-cols-[17rem_minmax(0,1fr)_minmax(0,22rem)]"
    >
      <div className="grid content-start justify-items-center gap-2">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-coach uppercase">
          Market balance · {label}
        </p>
        <BreadthDial breadth={read.breadth} lean={read.lean} />
        <p className="figures flex gap-4 text-sm">
          <span className="text-profit">▲ {buying} buying</span>
          <span className="text-loss">▼ {selling} selling</span>
        </p>
      </div>

      <div className="grid content-start gap-3">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-coach uppercase">
          What the flow says
        </p>
        <h2
          id="market-read"
          className={cn(
            "text-xl font-semibold tracking-tight sm:text-2xl",
            read.lean === "up" ? "text-profit" : read.lean === "down" ? "text-loss" : "text-ink",
          )}
        >
          {read.headline}
        </h2>
        <ReadList points={read.points} />
        <p className="text-xs text-ink-faint">
          A description of the last {label}, by fixed rules. It is not a forecast and not a buy or
          sell signal.
        </p>
      </div>

      <div className="grid grid-cols-2 content-start gap-3">
        <Tile
          label="Net market orders"
          value={usd(netFlowUsd)}
          tone={netFlowUsd >= 0 ? "text-profit" : "text-loss"}
          note="Market buys minus market sells, all coins."
        />
        <Tile
          label="Open interest"
          value={read.oiNetUsd === null ? "—" : usd(read.oiNetUsd)}
          tone={(read.oiNetUsd ?? 0) >= 0 ? "text-profit" : "text-loss"}
          note={
            (read.oiNetUsd ?? 0) >= 0
              ? "New positions opened (money in)."
              : "Positions closed (money out)."
          }
        />
        <Tile
          label="Adding vs closing"
          value={
            <>
              <span>{read.opening}</span>
              <span className="text-ink-faint"> / </span>
              <span>{read.closing}</span>
            </>
          }
          note="Coins opening new positions vs coins closing them."
        >
          {moving > 0 && (
            <div
              className="flex h-1.5 overflow-hidden rounded-full bg-hi/[0.06]"
              aria-hidden="true"
            >
              <span className="bg-coach" style={{ width: `${(read.opening / moving) * 100}%` }} />
            </div>
          )}
        </Tile>
        <Tile
          label="Stand-outs"
          value={read.unusual + read.absorbing + read.longsCrowded + read.shortsCrowded}
          note={`${read.unusual} unusual volume · ${read.absorbing} absorption · ${read.longsCrowded + read.shortsCrowded} crowded funding`}
        />
      </div>
    </section>
  );
}

// ─── Positioning patterns ───

const PATTERN_ICON: Record<Exclude<Regime, "neutral">, { price: 1 | -1; oi: 1 | -1 }> = {
  long_buildup: { price: 1, oi: 1 },
  short_buildup: { price: -1, oi: 1 },
  short_covering: { price: 1, oi: -1 },
  long_unwinding: { price: -1, oi: -1 },
};
const PATTERN_TELLS: Record<Exclude<Regime, "neutral">, string> = {
  long_buildup:
    "The strongest kind of rise: buyers are committing new money. Watch funding; if it gets high, the long side is crowded.",
  short_buildup:
    "The strongest kind of fall: sellers are opening new shorts. If price stops falling, those shorts can be forced to buy back.",
  short_covering:
    "The rise is mainly shorts closing. Once they have bought back, the push can run out unless new buyers step in.",
  long_unwinding:
    "The fall is mainly longs giving up. Once they are out, the selling can dry up unless new shorts arrive.",
};

/** The four groups as cards: how many coins, how much money, and the leaders in each. */
export function PatternCards({
  coins,
  href,
  mine,
}: {
  coins: OrderflowCoinDto[];
  href: (symbol: string) => string;
  mine: Set<string>;
}) {
  const shown = coins.length || 1;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {(Object.keys(PATTERN_ICON) as Array<keyof typeof PATTERN_ICON>).map((r) => {
        const rows = coins
          .filter((c) => c.regime === r)
          .sort((a, b) => Math.abs(b.oiChangeUsd ?? 0) - Math.abs(a.oiChangeUsd ?? 0));
        const oi = rows.reduce((s, c) => s + (c.oiChangeUsd ?? 0), 0);
        const net = rows.reduce((s, c) => s + c.netFlowUsd, 0);
        const up = r === "long_buildup" || r === "short_covering";
        const icon = PATTERN_ICON[r];
        return (
          <section
            key={r}
            className={cn(
              "surface lift grid min-w-0 content-start gap-3 rounded-[var(--radius-surface)] border-t-2 p-5",
              up ? "border-t-profit/70" : "border-t-loss/70",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className={cn("font-semibold", up ? "text-profit" : "text-loss")}>
                  {REGIME_INFO[r].label}
                </h3>
                <p className="mt-0.5 flex gap-2 text-xs text-ink-muted">
                  <span>Price {icon.price > 0 ? "▲" : "▼"}</span>
                  <span>Open interest {icon.oi > 0 ? "▲" : "▼"}</span>
                </p>
              </div>
              <p className="figures pop-text text-3xl font-semibold">{rows.length}</p>
            </div>
            <div
              className="flex h-1.5 overflow-hidden rounded-full bg-hi/[0.06]"
              aria-hidden="true"
            >
              <span
                className={up ? "bg-profit" : "bg-loss"}
                style={{ width: `${(rows.length / shown) * 100}%` }}
              />
            </div>
            <dl className="figures grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-ink-faint">Open interest</dt>
                <dd className={cn("text-sm font-semibold", oi >= 0 ? "text-profit" : "text-loss")}>
                  {rows.length ? usd(oi) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint">Net market orders</dt>
                <dd className={cn("text-sm font-semibold", net >= 0 ? "text-profit" : "text-loss")}>
                  {rows.length ? usd(net) : "—"}
                </dd>
              </div>
            </dl>
            <p className="text-xs leading-relaxed text-ink-muted">
              <strong className="text-ink">What it tells us:</strong> {PATTERN_TELLS[r]}
            </p>
            {rows.length > 0 ? (
              <ul className="grid gap-1 border-t border-rule pt-2 text-sm">
                {rows.slice(0, 5).map((c) => (
                  <li key={c.symbol} className="flex items-center justify-between gap-2">
                    <Link
                      href={href(c.symbol)}
                      scroll={false}
                      className="truncate font-medium hover:underline"
                    >
                      {coinName(c.symbol)}
                      {mine.has(c.symbol) && <span className="ml-1 text-xs text-coach">●</span>}
                    </Link>
                    <span className="figures flex gap-2 text-xs">
                      <span className={c.priceChangePct >= 0 ? "text-profit" : "text-loss"}>
                        {pct(c.priceChangePct)}
                      </span>
                      <span className="w-16 text-right text-ink-muted">
                        {usd(c.oiChangeUsd ?? 0)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-t border-rule pt-2 text-sm text-ink-faint">No coin right now.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ─── Stand-outs ───

function Board({
  icon: Icon,
  title,
  tells,
  rows,
  empty,
  href,
  mine,
}: {
  icon: LucideIcon;
  title: string;
  tells: string;
  rows: Array<{ c: OrderflowCoinDto; value: string; bar: number; tone: string; tag?: string }>;
  empty: string;
  href: (symbol: string) => string;
  mine: Set<string>;
}) {
  return (
    <section className="surface grid min-w-0 content-start gap-3 rounded-[var(--radius-surface)] p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-coach/15 text-coach ring-1 ring-coach/30">
          <Icon aria-hidden="true" className="size-4.5" />
        </span>
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-xs leading-snug text-ink-muted">{tells}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-faint">{empty}</p>
      ) : (
        <ol className="grid gap-2">
          {rows.map(({ c, value, bar, tone, tag }, i) => (
            <li key={c.symbol} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="figures w-4 text-xs text-ink-faint">{i + 1}</span>
                  <Link
                    href={href(c.symbol)}
                    scroll={false}
                    className="truncate font-medium hover:underline"
                  >
                    {coinName(c.symbol)}
                  </Link>
                  {mine.has(c.symbol) && <span className="text-xs text-coach">●</span>}
                  {tag && <span className="truncate text-xs text-ink-faint">{tag}</span>}
                </span>
                <span className={cn("figures shrink-0 font-semibold", tone)}>{value}</span>
              </div>
              <div
                className="ml-6 h-1 overflow-hidden rounded-full bg-hi/[0.05]"
                aria-hidden="true"
              >
                <span
                  className={cn(
                    "block h-full rounded-full",
                    tone.includes("loss")
                      ? "bg-loss"
                      : tone.includes("profit")
                        ? "bg-profit"
                        : "bg-coach",
                  )}
                  style={{ width: `${Math.max(4, Math.min(100, bar * 100))}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Six short leaderboards of what stands out in this window. */
export function StandOuts({
  coins,
  window,
  href,
  mine,
}: {
  coins: OrderflowCoinDto[];
  window: OrderflowWindow;
  href: (symbol: string) => string;
  mine: Set<string>;
}) {
  const N = 5;
  const t = STRENGTH_THRESHOLDS[window];
  const top = <T,>(xs: T[], key: (x: T) => number) =>
    [...xs].sort((a, b) => key(b) - key(a)).slice(0, N);
  const rel = (v: number, max: number) => (max > 0 ? Math.abs(v) / max : 0);

  const buyers = top(
    coins.filter((c) => c.buyPressurePct >= t.lean),
    (c) => c.buyPressurePct,
  );
  const sellers = top(
    coins.filter((c) => c.buyPressurePct <= -t.lean),
    (c) => -c.buyPressurePct,
  );
  const oiMovers = top(
    coins.filter((c) => c.oiChangeUsd !== null && c.oiChangeUsd !== 0),
    (c) => Math.abs(c.oiChangeUsd ?? 0),
  );
  const unusual = top(
    coins.filter((c) => (c.relVolume ?? 0) >= UNUSUAL_VOLUME),
    (c) => c.relVolume ?? 0,
  );
  const absorbing = top(
    coins.filter((c) => divergenceOf(c, window) !== null),
    (c) => Math.abs(c.buyPressurePct),
  );
  const crowded = top(
    coins.filter((c) => fundingStateOf(c.funding) !== null),
    (c) => Math.abs(c.funding ?? 0),
  );
  const maxOf = (xs: OrderflowCoinDto[], f: (c: OrderflowCoinDto) => number) =>
    Math.max(0, ...xs.map((c) => Math.abs(f(c))));

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Board
        icon={ArrowUp}
        title="Strongest buying"
        tells={`Highest share of market buying (from +${t.lean}% on ${ORDERFLOW_WINDOW_LABEL[window]}). Buyers are paying up to get in.`}
        rows={buyers.map((c) => ({
          c,
          value: pct(c.buyPressurePct, 1),
          bar: rel(
            c.buyPressurePct,
            maxOf(buyers, (x) => x.buyPressurePct),
          ),
          tone: "text-profit",
          tag: STRENGTH_LABEL[c.strength],
        }))}
        empty="No coin crossed the buying line in this window."
        href={href}
        mine={mine}
      />
      <Board
        icon={ArrowDown}
        title="Strongest selling"
        tells={`Highest share of market selling (from −${t.lean}%). Sellers are hitting the bids to get out or go short.`}
        rows={sellers.map((c) => ({
          c,
          value: pct(c.buyPressurePct, 1),
          bar: rel(
            c.buyPressurePct,
            maxOf(sellers, (x) => x.buyPressurePct),
          ),
          tone: "text-loss",
          tag: STRENGTH_LABEL[c.strength],
        }))}
        empty="No coin crossed the selling line in this window."
        href={href}
        mine={mine}
      />
      <Board
        icon={Layers}
        title="Biggest position changes"
        tells="Largest open-interest change in dollars. Plus = new positions opened (money in), minus = positions closed (money out)."
        rows={oiMovers.map((c) => ({
          c,
          value: usd(c.oiChangeUsd ?? 0),
          bar: rel(
            c.oiChangeUsd ?? 0,
            maxOf(oiMovers, (x) => x.oiChangeUsd ?? 0),
          ),
          tone: (c.oiChangeUsd ?? 0) >= 0 ? "text-profit" : "text-loss",
          tag: REGIME_INFO[c.regime].label,
        }))}
        empty="No open-interest data yet."
        href={href}
        mine={mine}
      />
      <Board
        icon={Zap}
        title="Unusual activity"
        tells={`Trading at ${UNUSUAL_VOLUME}× or more its usual pace. Something is drawing attention: check the news first.`}
        rows={unusual.map((c) => ({
          c,
          value: relVolumeText(c.relVolume ?? 0),
          bar: rel(
            c.relVolume ?? 0,
            maxOf(unusual, (x) => x.relVolume ?? 0),
          ),
          tone: "text-coach",
          tag: STRENGTH_LABEL[c.strength],
        }))}
        empty={
          window === "24h"
            ? "Not measured on 1D (there is no longer baseline to compare with)."
            : "Every coin is trading at a normal pace."
        }
        href={href}
        mine={mine}
      />
      <Board
        icon={Magnet}
        title="Absorption"
        tells="Price moved against the market orders, or heavy orders did not move it. Resting orders are taking the other side."
        rows={absorbing.map((c) => {
          const d = divergenceOf(c, window);
          return {
            c,
            value: pct(c.buyPressurePct, 1),
            bar: rel(
              c.buyPressurePct,
              maxOf(absorbing, (x) => x.buyPressurePct),
            ),
            tone: d ? TONE_TEXT[DIVERGENCE_INFO[d].tone] : "",
            tag: d ? `${DIVERGENCE_INFO[d].label} · price ${pct(c.priceChangePct)}` : undefined,
          };
        })}
        empty="Price and market orders agree everywhere right now."
        href={href}
        mine={mine}
      />
      <Board
        icon={Flame}
        title="Crowded funding"
        tells="Funding of +0.03% or more (longs pay a lot) or −0.01% or less (shorts pay). The crowded side is the one that gets squeezed when price turns."
        rows={crowded.map((c) => ({
          c,
          value: fundingPct(c.funding ?? 0),
          bar: rel(
            c.funding ?? 0,
            maxOf(crowded, (x) => x.funding ?? 0),
          ),
          tone: (c.funding ?? 0) > 0 ? "text-profit" : "text-loss",
          tag: fundingStateOf(c.funding) === "longs_crowded" ? "Longs crowded" : "Shorts crowded",
        }))}
        empty="Funding is normal on every shown coin."
        href={href}
        mine={mine}
      />
    </div>
  );
}

// ─── Flow across timeframes ───

const ALIGN_TONE: Record<FlowAlignment, string> = {
  up: "bg-profit/20 text-profit ring-profit/40",
  down: "bg-loss/20 text-loss ring-loss/40",
  conflict: "bg-[#f59e0b]/15 text-[#f59e0b] ring-[#f59e0b]/40",
  mixed: "bg-hi/[0.05] text-ink-muted ring-rule",
};

/**
 * Every shown coin on every window at once: each cell is the buy pressure in that window, coloured
 * by strength. The last column says whether 5m, 15m and 1H point the same way.
 */
export function FlowMatrix({
  coins,
  across,
  window,
  href,
  mine,
  filter,
  filterHref,
}: {
  coins: OrderflowCoinDto[];
  across: OrderflowAcross;
  window: OrderflowWindow;
  href: (symbol: string) => string;
  mine: Set<string>;
  filter: "all" | "aligned" | "conflict";
  filterHref: (f: "all" | "aligned" | "conflict") => string;
}) {
  const rows = [...coins]
    .map((c) => ({ c, cells: across[c.symbol] ?? {}, a: alignmentOf(across[c.symbol] ?? {}) }))
    .sort(
      (x, y) => Number(isPinned(y.c.symbol)) - Number(isPinned(x.c.symbol)) || x.c.rank - y.c.rank,
    );
  const counts = {
    up: rows.filter((r) => r.a === "up").length,
    down: rows.filter((r) => r.a === "down").length,
    conflict: rows.filter((r) => r.a === "conflict").length,
  };
  const shown = rows.filter((r) =>
    filter === "aligned"
      ? r.a === "up" || r.a === "down"
      : filter === "conflict"
        ? r.a === "conflict"
        : true,
  );
  const chip = (f: "all" | "aligned" | "conflict", text: string) => (
    <Link
      href={filterHref(f)}
      scroll={false}
      aria-current={filter === f ? "true" : undefined}
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-3 text-sm whitespace-nowrap",
        filter === f
          ? "border-coach/60 bg-coach/15 font-medium text-ink"
          : "border-rule text-ink-muted hover:bg-hi/[0.06] hover:text-ink",
      )}
    >
      {text}
    </Link>
  );
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="figures flex flex-wrap gap-3 text-sm">
          <span className="text-profit">▲ {counts.up} lined up buying</span>
          <span className="text-loss">▼ {counts.down} lined up selling</span>
          <span className="text-[#f59e0b]">⇄ {counts.conflict} pulling apart</span>
        </p>
        <nav aria-label="Filter the matrix" className="flex flex-wrap gap-2">
          {chip("all", "All coins")}
          {chip("aligned", "Lined up only")}
          {chip("conflict", "Pulling apart")}
        </nav>
      </div>
      <div className="relative max-h-[34rem] overflow-auto rounded-[var(--radius-control)] border border-rule">
        <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-sheet/95 backdrop-blur">
            <tr className="text-xs text-ink-faint">
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Coin
              </th>
              {ORDERFLOW_WINDOWS.map((w) => (
                <th
                  key={w}
                  scope="col"
                  className={cn(
                    "px-1 py-2 text-center font-medium",
                    w === window && "text-coach",
                    (ALIGN_WINDOWS as readonly string[]).includes(w) &&
                      "underline decoration-coach/50 underline-offset-4",
                  )}
                >
                  {ORDERFLOW_WINDOW_LABEL[w]}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-medium">
                5m · 15m · 1H
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ c, cells, a }) => (
              <tr key={c.symbol} className="group">
                <td className="border-t border-rule px-3 py-1.5 whitespace-nowrap group-hover:bg-hi/[0.03]">
                  <Link
                    href={href(c.symbol)}
                    scroll={false}
                    className="font-medium hover:underline"
                  >
                    {coinName(c.symbol)}
                  </Link>
                  {mine.has(c.symbol) && <span className="ml-1.5 text-xs text-coach">● yours</span>}
                </td>
                {ORDERFLOW_WINDOWS.map((w) => {
                  const cell = cells[w];
                  return (
                    <td key={w} className="border-t border-rule px-1 py-1 group-hover:bg-hi/[0.03]">
                      {cell ? (
                        <span
                          title={`${coinName(c.symbol)} ${ORDERFLOW_WINDOW_LABEL[w]}: ${STRENGTH_LABEL[cell.s]}, buy pressure ${pct(cell.p, 1)}, ${REGIME_INFO[cell.r].label}`}
                          className={cn(
                            "figures flex h-7 items-center justify-center gap-1 rounded-md text-xs font-semibold",
                            STRENGTH_STYLE[cell.s].cell,
                            w === window && "ring-1 ring-coach/60",
                          )}
                        >
                          <span aria-hidden="true" className="text-[9px]">
                            {STRENGTH_STYLE[cell.s].mark}
                          </span>
                          {pct(cell.p, 0)}
                          <span className="sr-only">{STRENGTH_LABEL[cell.s]}</span>
                        </span>
                      ) : (
                        <span className="flex h-7 items-center justify-center text-xs text-ink-faint">
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="border-t border-rule px-3 py-1 text-right group-hover:bg-hi/[0.03]">
                  <span
                    className={cn(
                      "inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold whitespace-nowrap ring-1",
                      ALIGN_TONE[a],
                    )}
                  >
                    {ALIGNMENT_TEXT[a]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="p-4 text-sm text-ink-muted">No coin matches this filter right now.</p>
        )}
      </div>
    </div>
  );
}

// ─── Glossary ───

const GLOSSARY: Array<{
  icon: LucideIcon;
  term: string;
  what: string;
  tells: string;
  careful: string;
}> = [
  {
    icon: Activity,
    term: "Market orders (taker flow)",
    what: "Orders that buy or sell immediately at the best available price, crossing the spread.",
    tells: "Who is in a hurry. Traders pay the spread when they want in (or out) now.",
    careful: "A burst can come from one large trader or forced closes, not a crowd.",
  },
  {
    icon: ArrowUp,
    term: "Buy pressure %",
    what: "Market buys minus market sells, as a share of everything traded. +100% only buying, −100% only selling.",
    tells:
      "How one-sided the hurry is. Strength turns it into Strong buying … Strong selling per timeframe.",
    careful:
      "Short windows swing more, so 5m needs ±10% to count and ±25% to be strong; 1D needs ±2% and ±5%.",
  },
  {
    icon: Layers,
    term: "Open interest (OI)",
    what: "How many futures contracts are still open, counted in coins so price moves do not change it.",
    tells: "Whether money is entering (rising) or leaving (falling) the market.",
    careful: "OI alone has no direction: every long has a short on the other side.",
  },
  {
    icon: Scale,
    term: "The four patterns",
    what: "Price change and OI change together: Long build-up (↑↑), Short build-up (↓↑), Short covering (↑↓), Long unwinding (↓↓).",
    tells:
      "Whether a move is driven by new money (build-ups) or by traders closing (covering, unwinding).",
    careful: "Very small moves count as No clear flow, so noise never decides a group.",
  },
  {
    icon: Flame,
    term: "Funding rate",
    what: "The fee longs and shorts pay each other every few hours to keep the futures price near spot.",
    tells:
      "Which side is crowded. High positive = many longs paying to stay in; negative = many shorts.",
    careful: "Crowded can stay crowded for a long time; it shows risk, not timing.",
  },
  {
    icon: Zap,
    term: "Relative volume",
    what: "This window's trading pace divided by the usual pace over the last hours.",
    tells: `Attention. ${UNUSUAL_VOLUME}× or more is unusual and often comes with news; under ${0.5}× is quiet.`,
    careful: "Flow on very quiet markets can reverse quickly.",
  },
  {
    icon: Magnet,
    term: "Absorption",
    what: "Price moving against the market orders, or heavy market orders that do not move price.",
    tells: "Large resting (limit) orders are taking the other side at that level.",
    careful: "Absorption can break: when the resting orders are used up, price often moves fast.",
  },
  {
    icon: Info,
    term: "Lined up (5m · 15m · 1H)",
    what: "Whether the three scalping timeframes all show buying, all show selling, or disagree.",
    tells:
      "Lined up = short-term and hourly flow agree. Pulling apart = the short-term move is against the bigger one.",
    careful: "It describes the last minutes and hours; it does not say what comes next.",
  },
];

export function Glossary() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {GLOSSARY.map((g) => (
        <section
          key={g.term}
          className="surface grid content-start gap-2 rounded-[var(--radius-surface)] p-5"
        >
          <h3 className="flex items-center gap-2 font-semibold">
            <g.icon aria-hidden="true" className="size-4 text-coach" />
            {g.term}
          </h3>
          <p className="text-sm text-ink-muted">{g.what}</p>
          <p className="text-sm">
            <strong className="text-profit">Tells us: </strong>
            {g.tells}
          </p>
          <p className="text-xs text-ink-faint">
            <strong className="text-[#f59e0b]">Careful: </strong>
            {g.careful}
          </p>
        </section>
      ))}
    </div>
  );
}
