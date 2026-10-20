import {
  type AcrossCell,
  DESK_SYMBOLS,
  DIVERGENCE_INFO,
  divergenceOf,
  ORDERFLOW_MIN_MOVE,
  ORDERFLOW_WINDOW_LABEL,
  ORDERFLOW_WINDOWS,
  type OrderflowCoinDto,
  type OrderflowWindow,
  REGIME_INFO,
  type ReadPoint,
  type Regime,
  relVolumeText,
  STRENGTH_LABEL,
  signedFixed,
  signedPct,
  UNUSUAL_VOLUME,
} from "@atc/shared";
import Link from "next/link";
import { formatPrice } from "@/features/live/market";
import { cn } from "@/lib/cn";
import { coinName, pct, usd } from "./format";
import { ReadList, TONE_TEXT } from "./insights";
import { STRENGTH_STYLE, StrengthBadge } from "./strength";

const fundingPct = (f: number | null) => (f === null ? "—" : signedPct(f * 100, 4));
const tone = (v: number | null) =>
  v === null || v === 0 ? "" : v > 0 ? "text-profit" : "text-loss";

export const REGIME_TONE: Record<Regime, string> = {
  long_buildup: "text-profit",
  short_covering: "text-profit",
  short_buildup: "text-loss",
  long_unwinding: "text-loss",
  neutral: "text-ink-muted",
};
const REGIME_FILL: Record<Regime, string> = {
  long_buildup: "var(--pnl-profit)",
  short_covering: "color-mix(in srgb, var(--pnl-profit) 55%, transparent)",
  short_buildup: "var(--pnl-loss)",
  long_unwinding: "color-mix(in srgb, var(--pnl-loss) 55%, transparent)",
  neutral: "var(--color-ink-faint)",
};

/**
 * Positioning map: price change across, open-interest change up. Each quadrant is one group; the
 * dashed band is the "too small to read" zone. Bubble size is the coin's traded value.
 */
export function PositioningMap({
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
  const pts = coins.filter((c) => c.oiChangePct !== null);
  const W = 920;
  const H = 460;
  const pad = { l: 52, r: 18, t: 18, b: 40 };
  const q = (vals: number[], p: number) => {
    const s = [...vals].map(Math.abs).sort((a, b) => a - b);
    return s[Math.floor((s.length - 1) * p)] ?? 1;
  };
  const m = ORDERFLOW_MIN_MOVE[window];
  // Axes cover 95% of coins; the rest sit on the edge with an arrow.
  const xMax = Math.max(
    m.price * 2,
    q(
      pts.map((c) => c.priceChangePct),
      0.95,
    ) * 1.15,
  );
  const yMax = Math.max(
    m.oi * 2,
    q(
      pts.map((c) => c.oiChangePct ?? 0),
      0.95,
    ) * 1.15,
  );
  const sx = (v: number) =>
    pad.l + ((Math.max(-xMax, Math.min(xMax, v)) + xMax) / (2 * xMax)) * (W - pad.l - pad.r);
  const sy = (v: number) =>
    pad.t + ((yMax - Math.max(-yMax, Math.min(yMax, v))) / (2 * yMax)) * (H - pad.t - pad.b);
  const maxVol = Math.max(1, ...pts.map((c) => c.volumeUsd));
  const labelled = new Set(
    [...pts]
      .sort((a, b) => Math.abs(b.oiChangeUsd ?? 0) - Math.abs(a.oiChangeUsd ?? 0))
      .slice(0, 14)
      .map((c) => c.symbol),
  );
  const ticks = (max: number) => [-max, -max / 2, 0, max / 2, max];
  const corner = (x: number, y: number, r: Regime, anchor: "start" | "end") => (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      className={cn("text-[12px] font-semibold", REGIME_TONE[r])}
      fill="currentColor"
    >
      {REGIME_INFO[r].label}
    </text>
  );
  return (
    <figure className="grid gap-2">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[40rem]"
          role="img"
          aria-label={`Price change against open interest change, last ${ORDERFLOW_WINDOW_LABEL[window]}`}
        >
          {/* Neutral band */}
          <rect
            x={sx(-m.price)}
            y={pad.t}
            width={sx(m.price) - sx(-m.price)}
            height={H - pad.t - pad.b}
            fill="var(--color-hi)"
            opacity={0.04}
          />
          <rect
            x={pad.l}
            y={sy(m.oi)}
            width={W - pad.l - pad.r}
            height={sy(-m.oi) - sy(m.oi)}
            fill="var(--color-hi)"
            opacity={0.04}
          />
          {ticks(xMax).map((t) => (
            <g key={`x${t}`}>
              <line
                x1={sx(t)}
                x2={sx(t)}
                y1={pad.t}
                y2={H - pad.b}
                stroke="var(--color-rule)"
                strokeDasharray={t === 0 ? undefined : "3 4"}
              />
              <text
                x={sx(t)}
                y={H - pad.b + 16}
                textAnchor="middle"
                className="figures text-[11px]"
                fill="var(--color-ink-faint)"
              >
                {pct(t, 1)}
              </text>
            </g>
          ))}
          {ticks(yMax).map((t) => (
            <g key={`y${t}`}>
              <line
                x1={pad.l}
                x2={W - pad.r}
                y1={sy(t)}
                y2={sy(t)}
                stroke="var(--color-rule)"
                strokeDasharray={t === 0 ? undefined : "3 4"}
              />
              <text
                x={pad.l - 6}
                y={sy(t) + 4}
                textAnchor="end"
                className="figures text-[11px]"
                fill="var(--color-ink-faint)"
              >
                {pct(t, 1)}
              </text>
            </g>
          ))}
          {corner(W - pad.r - 6, pad.t + 16, "long_buildup", "end")}
          {corner(pad.l + 6, pad.t + 16, "short_buildup", "start")}
          {corner(W - pad.r - 6, H - pad.b - 8, "short_covering", "end")}
          {corner(pad.l + 6, H - pad.b - 8, "long_unwinding", "start")}
          <text
            x={(W + pad.l) / 2}
            y={H - 4}
            textAnchor="middle"
            className="text-[11px]"
            fill="var(--color-ink-muted)"
          >
            Price change →
          </text>
          <text
            x={12}
            y={(H - pad.b) / 2}
            transform={`rotate(-90 12 ${(H - pad.b) / 2})`}
            textAnchor="middle"
            className="text-[11px]"
            fill="var(--color-ink-muted)"
          >
            Open interest change →
          </text>
          {pts
            .sort((a, b) => b.volumeUsd - a.volumeUsd)
            .map((c) => {
              const x = sx(c.priceChangePct);
              const y = sy(c.oiChangePct ?? 0);
              const r = 3 + 11 * Math.sqrt(c.volumeUsd / maxVol);
              return (
                <Link key={c.symbol} href={href(c.symbol)} scroll={false}>
                  <title>
                    {`${coinName(c.symbol)} · ${REGIME_INFO[c.regime].label}\nPrice ${pct(c.priceChangePct)} · Open interest ${pct(c.oiChangePct)} (${usd(c.oiChangeUsd ?? 0)})\nNet taker ${usd(c.netFlowUsd)}`}
                  </title>
                  <circle
                    cx={x}
                    cy={y}
                    r={r}
                    fill={REGIME_FILL[c.regime]}
                    fillOpacity={0.35}
                    stroke={mine.has(c.symbol) ? "var(--color-coach)" : REGIME_FILL[c.regime]}
                    strokeWidth={mine.has(c.symbol) ? 2.5 : 1}
                  />
                  {labelled.has(c.symbol) && (
                    <text
                      x={x > W * 0.85 ? x - r - 3 : x + r + 3}
                      y={y + 4}
                      textAnchor={x > W * 0.85 ? "end" : "start"}
                      className="text-[11px] font-semibold"
                      fill="var(--color-ink)"
                    >
                      {coinName(c.symbol)}
                    </text>
                  )}
                </Link>
              );
            })}
        </svg>
      </div>
      <figcaption className="text-xs text-ink-faint">
        Each bubble is one coin (bigger = more traded); click one for detail. The shaded bands are
        moves too small to read (price under {m.price}%, open interest under {m.oi}% in{" "}
        {ORDERFLOW_WINDOW_LABEL[window]}). Coins beyond the edges sit on the border.
      </figcaption>
    </figure>
  );
}

export const TABLE_SORTS = [
  { id: "volume", label: "Volume" },
  { id: "flow", label: "Net taker" },
  { id: "oi", label: "New money (OI $)" },
  { id: "price", label: "Price" },
  { id: "funding", label: "Funding" },
  { id: "activity", label: "Activity" },
] as const;
export type TableSort = (typeof TABLE_SORTS)[number]["id"];
const SORT_KEY: Record<TableSort, (c: OrderflowCoinDto) => number> = {
  volume: (c) => c.rank,
  flow: (c) => -Math.abs(c.netFlowUsd),
  oi: (c) => -Math.abs(c.oiChangeUsd ?? 0),
  price: (c) => -Math.abs(c.priceChangePct),
  funding: (c) => -Math.abs(c.funding ?? 0),
  activity: (c) => -(c.relVolume ?? 0),
};

/** Every coin with every figure. */
export function CoinsTable({
  coins,
  sort,
  window,
  href,
  mine,
}: {
  coins: OrderflowCoinDto[];
  sort: TableSort;
  window: OrderflowWindow;
  href: (symbol: string) => string;
  mine: Set<string>;
}) {
  const rows = [...coins].sort((a, b) => SORT_KEY[sort](a) - SORT_KEY[sort](b) || a.rank - b.rank);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[66rem] text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-faint">
            {[
              "#",
              "Coin",
              "Group",
              "Strength",
              "Price",
              "Change",
              "Open interest",
              "OI $",
              "Net taker",
              "Buy pressure",
              "Funding",
              "Activity",
              "Volume",
              "Note",
            ].map((h, i) => (
              <th
                key={h}
                scope="col"
                className={cn(
                  "pb-2 font-medium",
                  i >= 4 && i < 13 && "text-right",
                  i === 13 && "pl-4",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr
              key={c.symbol}
              className={cn("border-t border-rule", mine.has(c.symbol) && "bg-coach/[0.07]")}
            >
              <td className="figures py-1.5 text-ink-faint">{c.rank}</td>
              <td>
                <Link href={href(c.symbol)} scroll={false} className="font-medium hover:underline">
                  {coinName(c.symbol)}
                </Link>
                {mine.has(c.symbol) && <span className="ml-1.5 text-xs text-coach">● yours</span>}
              </td>
              <td className={cn("text-xs whitespace-nowrap", REGIME_TONE[c.regime])}>
                {REGIME_INFO[c.regime].label}
              </td>
              <td>
                <StrengthBadge strength={c.strength} />
              </td>
              <td className="figures text-right">{formatPrice(c.price)}</td>
              <td className={cn("figures text-right", tone(c.priceChangePct))}>
                {pct(c.priceChangePct)}
              </td>
              <td className={cn("figures text-right", tone(c.oiChangePct))}>
                {pct(c.oiChangePct)}
              </td>
              <td className={cn("figures text-right", tone(c.oiChangeUsd))}>
                {c.oiChangeUsd === null ? "—" : usd(c.oiChangeUsd)}
              </td>
              <td className={cn("figures text-right", tone(c.netFlowUsd))}>{usd(c.netFlowUsd)}</td>
              <td className={cn("figures text-right", tone(c.buyPressurePct))}>
                {pct(c.buyPressurePct, 1)}
              </td>
              <td className={cn("figures text-right", tone(c.funding))}>{fundingPct(c.funding)}</td>
              <td
                className={cn(
                  "figures text-right",
                  (c.relVolume ?? 0) >= UNUSUAL_VOLUME
                    ? "font-semibold text-coach"
                    : "text-ink-muted",
                )}
              >
                {c.relVolume === null ? "—" : relVolumeText(c.relVolume)}
              </td>
              <td className="figures text-right text-ink-muted">
                {usd(c.volumeUsd).replace("+", "")}
              </td>
              <td className="pl-4 text-xs whitespace-nowrap">
                {(() => {
                  const d = divergenceOf(c, window);
                  return d ? (
                    <span className={TONE_TEXT[DIVERGENCE_INFO[d].tone]}>
                      {DIVERGENCE_INFO[d].label}
                    </span>
                  ) : null;
                })()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Spark({
  values,
  label,
  unit = "%",
}: {
  values: number[] | null;
  label: string;
  unit?: string;
}) {
  const W = 280;
  const H = 70;
  if (!values || values.length < 2)
    return (
      <div className="rounded-[var(--radius-control)] border border-rule p-3">
        <p className="text-xs text-ink-faint">{label}</p>
        <p className="mt-2 text-sm text-ink-muted">Not available.</p>
      </div>
    );
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => 6 + ((hi - v) / span) * (H - 12);
  const last = values.at(-1) ?? 0;
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <div className="rounded-[var(--radius-control)] border border-rule p-3">
      <p className="flex justify-between text-xs text-ink-faint">
        {label}
        <span className={cn("figures font-semibold", tone(last))}>
          {signedFixed(last, 2)}
          {unit}
        </span>
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 h-16 w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--color-rule)" strokeDasharray="3 4" />
        <path
          d={d}
          fill="none"
          stroke={last >= 0 ? "var(--pnl-profit)" : "var(--pnl-loss)"}
          strokeWidth={1.8}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

/** One coin: the three series side by side, its figures and where to go next. */
export function CoinDetail({
  coin,
  window,
  closeHref,
  held,
  read,
  cells,
  windowHref,
}: {
  coin: OrderflowCoinDto;
  window: OrderflowWindow;
  closeHref: string;
  held: boolean;
  read: ReadPoint[];
  cells: Partial<Record<OrderflowWindow, AcrossCell>>;
  windowHref: (w: OrderflowWindow) => string;
}) {
  const info = REGIME_INFO[coin.regime];
  const desk = (DESK_SYMBOLS as readonly string[]).includes(coin.symbol);
  return (
    <section
      id="coin"
      aria-label={`${coinName(coin.symbol)} order flow`}
      className="surface hud grid scroll-mt-24 gap-5 rounded-[var(--radius-surface)] p-5 ring-1 ring-coach/40 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {coinName(coin.symbol)}{" "}
            <span className="figures text-base font-normal text-ink-muted">
              {formatPrice(coin.price)}
            </span>
            {held && <span className="ml-2 text-sm text-coach">● you hold this</span>}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <StrengthBadge strength={coin.strength} />
            <span className={cn("font-medium", REGIME_TONE[coin.regime])}>{info.label}</span>
            <span className="text-ink-faint">· last {ORDERFLOW_WINDOW_LABEL[window]}</span>
          </p>
        </div>
        <Link
          href={closeHref}
          scroll={false}
          className="text-sm text-ink-muted hover:text-ink hover:underline"
        >
          Close
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-2">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-coach uppercase">
            What this tells us
          </p>
          <ReadList points={read} />
        </div>
        <div className="grid content-start gap-2">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-coach uppercase">
            Every timeframe
          </p>
          <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-3">
            {ORDERFLOW_WINDOWS.map((w) => {
              const cell = cells[w];
              return (
                <li key={w}>
                  <Link
                    href={windowHref(w)}
                    scroll={false}
                    title={
                      cell
                        ? `${STRENGTH_LABEL[cell.s]} · ${REGIME_INFO[cell.r].label}`
                        : "Not current"
                    }
                    className={cn(
                      "grid justify-items-center gap-0.5 rounded-[var(--radius-control)] p-2 text-center",
                      cell ? STRENGTH_STYLE[cell.s].cell : "bg-hi/[0.03] text-ink-faint",
                      w === window && "ring-2 ring-coach",
                    )}
                  >
                    <span className="text-[11px] font-medium opacity-80">
                      {ORDERFLOW_WINDOW_LABEL[w]}
                    </span>
                    <span className="figures text-sm font-semibold">
                      {cell ? pct(cell.p, 1) : "—"}
                    </span>
                    <span className="text-[10px] leading-tight">
                      {cell ? STRENGTH_LABEL[cell.s] : "n/a"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          <p className="text-xs text-ink-faint">Buy pressure per timeframe. Click one to switch.</p>
        </div>
      </div>
      <dl className="figures grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Price", pct(coin.priceChangePct), tone(coin.priceChangePct)],
          ["Open interest", pct(coin.oiChangePct), tone(coin.oiChangePct)],
          [
            "New money (OI $)",
            coin.oiChangeUsd === null ? "—" : usd(coin.oiChangeUsd),
            tone(coin.oiChangeUsd),
          ],
          ["Net taker", usd(coin.netFlowUsd), tone(coin.netFlowUsd)],
          ["Buy pressure", pct(coin.buyPressurePct, 1), tone(coin.buyPressurePct)],
          ["Funding (next)", fundingPct(coin.funding), tone(coin.funding)],
        ].map(([k, v, t]) => (
          <div key={k} className="raised rounded-[var(--radius-control)] p-3">
            <dt className="text-xs text-ink-faint">{k}</dt>
            <dd className={cn("mt-1 text-base font-semibold", t)}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-3 md:grid-cols-3">
        <Spark
          values={coin.series.price}
          label={`Price since ${ORDERFLOW_WINDOW_LABEL[window]} ago`}
        />
        <Spark values={coin.series.oi} label="Open interest" />
        <Spark values={coin.series.pressure} label="Buy pressure (cumulative)" />
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link
          href={`/live?s=${coin.symbol}`}
          className="text-coach underline-offset-4 hover:underline"
        >
          Open the live chart
        </Link>
        {desk && (
          <Link
            href={`/check?s=${coin.symbol}`}
            className="text-coach underline-offset-4 hover:underline"
          >
            Trade Check
          </Link>
        )}
        <Link
          href={`/market/${coin.symbol}`}
          className="text-coach underline-offset-4 hover:underline"
        >
          Link to Bitcoin (Market Pulse)
        </Link>
      </p>
    </section>
  );
}
