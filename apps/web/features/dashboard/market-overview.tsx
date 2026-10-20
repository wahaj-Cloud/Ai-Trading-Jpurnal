"use client";

import { altcoinSeasonLabel, fearGreedLabel, type MarketOverviewDto } from "@atc/shared";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/cn";
import { useMounted } from "@/lib/use-mounted";
import { getMarketOverviewAction } from "./market-actions";

const REFRESH_MS = 5 * 60_000;
const usdCompact = (v: number) =>
  `$${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(v)}`;

/** Fear & Greed colours, red (fear) to teal (greed). */
const FG_STOPS = ["#ef4444", "#f59e0b", "#eab308", "#84cc16", "#2dd4bf"];

function Card({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "surface flex min-h-[11.5rem] flex-col rounded-[var(--radius-surface)] p-4",
        className,
      )}
    >
      <h3 className="text-sm font-medium text-ink-muted">{title}</h3>
      {children}
    </section>
  );
}

function Sparkline({ points, up }: { points: Array<{ t: number; usd: number }>; up: boolean }) {
  const id = useId().replace(/:/g, "");
  if (points.length < 2) {
    return (
      <p className="mt-auto text-xs text-ink-faint">The 7-day chart fills in as readings arrive.</p>
    );
  }
  const W = 300;
  const H = 64;
  const vs = points.map((p) => p.usd);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const t0 = points[0]?.t ?? 0;
  const span = (points.at(-1)?.t ?? 1) - t0 || 1;
  const xy = points.map((p) => [
    ((p.t - t0) / span) * W,
    H - 4 - ((p.usd - min) / (max - min || 1)) * (H - 8),
  ]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x?.toFixed(1)},${y?.toFixed(1)}`).join(" ");
  const color = up ? "var(--color-profit, #26b07e)" : "var(--color-loss, #e5484d)";
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-auto h-16 w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#${id}f)`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Gauge({ value }: { value: number }) {
  const id = useId().replace(/:/g, "");
  // Semicircle from 180° (left, 0) to 0° (right, 100).
  const R = 46;
  const cx = 60;
  const cy = 56;
  const angle = Math.PI * (1 - Math.max(0, Math.min(100, value)) / 100);
  const kx = cx + R * Math.cos(angle);
  const ky = cy - R * Math.sin(angle);
  return (
    <svg viewBox="0 0 120 64" className="mx-auto w-full max-w-[13rem]" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="0">
          {FG_STOPS.map((c, i) => (
            <stop key={c} offset={i / (FG_STOPS.length - 1)} stopColor={c} />
          ))}
        </linearGradient>
      </defs>
      <path
        d={`M${cx - R},${cy} A${R},${R} 0 0 1 ${cx + R},${cy}`}
        fill="none"
        stroke={`url(#${id}g)`}
        strokeWidth="9"
        strokeLinecap="round"
      />
      <circle cx={kx} cy={ky} r="6.5" fill="#0b1020" stroke="#e2e8f0" strokeWidth="2.5" />
    </svg>
  );
}

/**
 * Three market cards on the dashboard: total crypto market cap (with a 7-day chart), the
 * CoinMarketCap Fear & Greed Index and the Altcoin Season Index. Refreshes every 5 minutes.
 */
export function MarketOverview({ initial }: { initial: MarketOverviewDto }) {
  const [data, setData] = useState(initial);
  useEffect(() => {
    const t = setInterval(() => {
      void getMarketOverviewAction().then((d) => d && setData(d));
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, []);
  const { marketCap: mc, fearGreed: fg, altcoinSeason: alt } = data;
  const up = (mc?.change24hPct ?? 0) >= 0;
  const updated = mc?.updatedAt ?? fg?.updatedAt ?? alt?.updatedAt;
  const local = useMounted();

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
        <Card title="Crypto market cap">
          {mc ? (
            <>
              <p className="figures mt-1 text-3xl font-semibold tracking-tight">
                {usdCompact(mc.usd)}
              </p>
              <p className="figures mt-0.5 flex flex-wrap items-center gap-x-3 text-sm">
                {mc.change24hPct !== null && (
                  <span
                    className={cn("inline-flex items-center", up ? "text-profit" : "text-loss")}
                  >
                    {up ? (
                      <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ArrowDownRight className="h-4 w-4" aria-hidden="true" />
                    )}
                    {Math.abs(mc.change24hPct).toFixed(2)}% 24h
                  </span>
                )}
                {mc.btcDominance !== null && (
                  <span className="text-xs text-ink-faint">
                    BTC dominance {mc.btcDominance.toFixed(1)}%
                  </span>
                )}
              </p>
              <Sparkline points={mc.sparkline} up={up} />
            </>
          ) : (
            <p className="mt-auto text-sm text-ink-muted">Waiting for the first reading.</p>
          )}
        </Card>

        <Card title="Fear & Greed">
          {fg ? (
            <div className="mt-auto grid justify-items-center">
              <Gauge value={fg.value} />
              <p className="figures -mt-7 text-3xl font-semibold">{Math.round(fg.value)}</p>
              <p className="text-sm text-ink-muted">{fg.label || fearGreedLabel(fg.value)}</p>
            </div>
          ) : (
            <p className="mt-auto text-sm text-ink-muted">Waiting for the first reading.</p>
          )}
        </Card>

        <Card title="Altcoin Season Index">
          {alt ? (
            <>
              <p className="figures mt-1 text-3xl font-semibold tracking-tight">
                {Math.round(alt.value)}
                <span className="text-xl font-normal text-ink-faint">/100</span>
              </p>
              <p className="text-sm text-ink-muted">{altcoinSeasonLabel(alt.value)}</p>
              <div className="mt-auto">
                <div className="relative h-2.5 rounded-full bg-[linear-gradient(90deg,#f59e0b_0%,#f59e0b_25%,#cbd5e1_25%,#cbd5e1_75%,#3b82f6_75%,#3b82f6_100%)]">
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 h-4.5 w-4.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-[#e2e8f0] bg-[#0b1020]"
                    style={{ left: `${Math.max(0, Math.min(100, alt.value))}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-xs text-ink-faint">
                  <span>Bitcoin season</span>
                  <span>Altcoin season</span>
                </div>
              </div>
            </>
          ) : (
            <p className="mt-auto text-sm text-ink-muted">Waiting for the first reading.</p>
          )}
        </Card>
      </div>
      <p className="text-right text-[11px] text-ink-faint">
        Data from{" "}
        <a
          href="https://coinmarketcap.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-ink-muted"
        >
          CoinMarketCap
        </a>
        {updated
          ? ` · updated ${new Date(updated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...(local ? {} : { timeZone: "UTC", timeZoneName: "short" }) })}`
          : ""}
      </p>
    </div>
  );
}
