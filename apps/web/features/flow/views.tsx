import {
  BIAS_LABEL,
  type BiasState,
  type FlowSummaryDto,
  type TimeframeBiasDto,
} from "@atc/shared";
import { cn } from "@/lib/cn";

const compactUsd = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
export const usdCompact = (v: number) => {
  const body = compactUsd.format(Math.abs(v));
  // No minus on an amount that shows as $0.
  return `${v < 0 && body !== "0" ? "−" : ""}$${body}`;
};
export const signedUsd = (v: number) =>
  v > 0 && compactUsd.format(v) !== "0" ? `+${usdCompact(v)}` : usdCompact(v);

const BIAS_STYLE: Record<BiasState, { arrow: string; cls: string }> = {
  up: { arrow: "▲", cls: "bg-profit/12 text-profit" },
  down: { arrow: "▼", cls: "bg-loss/12 text-loss" },
  range: { arrow: "◆", cls: "bg-hi/[0.08] text-ink-muted" },
};
const TF_LABEL = { "1w": "1W", "1d": "1D", "4h": "4H", "1h": "1H" } as const;

export function BiasChip({
  bias,
  showTf = false,
}: {
  bias: TimeframeBiasDto | undefined;
  showTf?: boolean;
}) {
  if (!bias)
    return <span className="inline-flex h-6 items-center px-2 text-xs text-ink-faint">—</span>;
  const s = BIAS_STYLE[bias.state];
  return (
    <span
      title={`${TF_LABEL[bias.timeframe]}: ${BIAS_LABEL[bias.state]} for ${bias.bars}${bias.bars >= 99 ? "+" : ""} candles. ${bias.evidence.join(" ")}`}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        s.cls,
      )}
    >
      <span aria-hidden="true">{s.arrow}</span>
      {showTf && <span>{TF_LABEL[bias.timeframe]}</span>}
      {BIAS_LABEL[bias.state]}
    </span>
  );
}

/** Whale buys above the line, sells below; liquidations of longs and shorts in a strip under it. */
export function FlowChart({ series }: { series: FlowSummaryDto["series"] }) {
  const W = 600;
  const H = 180;
  const mid = 110;
  const maxWhale = Math.max(1, ...series.flatMap((s) => [s.whaleBuyUsd, s.whaleSellUsd]));
  const maxLiq = Math.max(1, ...series.map((s) => s.longLiqUsd + s.shortLiqUsd));
  const bw = W / series.length;
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
  return (
    <figure className="grid gap-2">
      <svg
        viewBox={`0 0 ${W} ${H + 18}`}
        className="h-auto w-full"
        role="img"
        aria-label="Whale buys and sells, and liquidations, over time"
      >
        <line
          x1="0"
          x2={W}
          y1={mid - 40}
          y2={mid - 40}
          stroke="currentColor"
          className="text-rule"
        />
        {series.map((s, i) => {
          const x = i * bw + bw * 0.15;
          const w = bw * 0.7;
          const up = (s.whaleBuyUsd / maxWhale) * 60;
          const down = (s.whaleSellUsd / maxWhale) * 60;
          const liq = ((s.longLiqUsd + s.shortLiqUsd) / maxLiq) * 50;
          const longPart =
            s.longLiqUsd + s.shortLiqUsd > 0
              ? liq * (s.longLiqUsd / (s.longLiqUsd + s.shortLiqUsd))
              : 0;
          return (
            <g key={s.t}>
              <title>
                {`${time(s.t)}: whales bought ${usdCompact(s.whaleBuyUsd)}, sold ${usdCompact(s.whaleSellUsd)}; liquidated longs ${usdCompact(s.longLiqUsd)}, shorts ${usdCompact(s.shortLiqUsd)}`}
              </title>
              <rect
                x={x}
                y={mid - 40 - up}
                width={w}
                height={up}
                rx="2"
                fill="#3EE0A3"
                opacity="0.85"
              />
              <rect
                x={x}
                y={mid - 40}
                width={w}
                height={down}
                rx="2"
                fill="#FF6B7A"
                opacity="0.85"
              />
              <rect
                x={x}
                y={H - liq}
                width={w}
                height={liq - longPart}
                rx="1"
                fill="#f59e0b"
                opacity="0.8"
              />
              <rect
                x={x}
                y={H - longPart}
                width={w}
                height={longPart}
                rx="1"
                fill="#8B5CF6"
                opacity="0.85"
              />
              {i % 3 === 0 && (
                <text x={x} y={H + 14} className="fill-ink-faint" fontSize="10">
                  {time(s.t)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        <Legend color="#3EE0A3" label="Whale buys" />
        <Legend color="#FF6B7A" label="Whale sells" />
        <Legend color="#8B5CF6" label="Longs liquidated" />
        <Legend color="#f59e0b" label="Shorts liquidated" />
      </figcaption>
    </figure>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
