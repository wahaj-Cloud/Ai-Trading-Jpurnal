import type { ContextCheckDto, TradeContextDto } from "@atc/shared";
import { CandlestickChart, Check, Minus, X } from "lucide-react";
import Link from "next/link";
import { formatNumber, formatPercent } from "@/features/trades/format";
import { cn } from "@/lib/cn";
import { AnalyzeButton } from "./analyze-button";

function CheckRow({ c }: { c: ContextCheckDto }) {
  const Icon = c.ok === null ? Minus : c.ok ? Check : X;
  return (
    <li className="flex gap-2.5 text-sm">
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          c.ok === null ? "text-ink-faint" : c.ok ? "text-profit" : "text-loss",
        )}
        aria-label={c.ok === null ? "Not applicable" : c.ok ? "Yes" : "No"}
      />
      <span>
        <span className={cn(c.ok === null && "text-ink-muted")}>{c.label}</span>
        <span className="block text-xs text-ink-muted">{c.detail}</span>
      </span>
    </li>
  );
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="figures text-sm">{value}</dd>
    </div>
  );
}

const side = (price: number, level: number | null) =>
  level === null ? "—" : `${price >= level ? "above" : "below"} (${formatNumber(String(level))})`;

/** Market context of the trade from exchange candles: readings, entry checklist and excursion. */
export function ContextPanel({
  positionId,
  context,
  status,
  marketData = true,
}: {
  positionId: string;
  context: TradeContextDto | null;
  status: "DONE" | "UNAVAILABLE" | "NONE";
  /** False for brokers we have no chart source for yet (MetaTrader). */
  marketData?: boolean;
}) {
  return (
    <section
      aria-labelledby="context-heading"
      className="rounded-[var(--radius-surface)] border border-rule bg-panel p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="context-heading" className="flex items-center gap-2 font-semibold">
          <CandlestickChart className="h-4 w-4 text-coach" aria-hidden="true" />
          Strategy analysis
        </h2>
        {context && (
          <p className="text-xs text-ink-faint">
            {context.timeframe} candles from{" "}
            {context.source.charAt(0) + context.source.slice(1).toLowerCase()}
          </p>
        )}
      </div>

      {!context && !marketData ? (
        <p className="mt-3 text-sm text-ink-muted">
          Chart data for this broker is not available yet, so strategy analysis is off for these
          trades. Your journal, grades and coaching still work.
        </p>
      ) : !context ? (
        <div className="mt-3 grid gap-3">
          <p className="text-sm text-ink-muted">
            {status === "UNAVAILABLE"
              ? "The exchange did not have enough chart history for this trade."
              : "See the trend, EMAs, RSI, VWAP, structure (BOS/CHOCH), fair value gaps, order blocks and liquidity at your entry, and how much of the move you captured."}
          </p>
          <AnalyzeButton
            positionId={positionId}
            label={status === "UNAVAILABLE" ? "Try again" : "Analyse this trade"}
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-5">
          {context.entryScore !== null && (
            <p className="text-sm">
              <span className="figures text-2xl font-semibold">{context.entryScore}%</span>{" "}
              <span className="text-ink-muted">of entry conditions were in your favour</span>
            </p>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Reading
              label="Structure"
              value={
                context.entry.trend === "RANGE"
                  ? "Ranging"
                  : `Trending ${context.entry.trend.toLowerCase()}`
              }
            />
            <Reading
              label="Last break"
              value={
                context.entry.lastStructure
                  ? `${context.entry.lastStructure.kind} ${context.entry.lastStructure.direction.toLowerCase()}, ${context.entry.lastStructure.candlesBefore} candles earlier`
                  : "None"
              }
            />
            <Reading
              label="RSI (14)"
              value={context.entry.rsi === null ? "—" : context.entry.rsi.toFixed(0)}
            />
            <Reading label="EMA 20" value={side(context.entry.price, context.entry.ema20)} />
            <Reading label="EMA 50" value={side(context.entry.price, context.entry.ema50)} />
            <Reading label="EMA 200" value={side(context.entry.price, context.entry.ema200)} />
            <Reading label="VWAP" value={side(context.entry.price, context.entry.vwap)} />
            <Reading
              label="Volume"
              value={
                context.entry.volumeRatio === null
                  ? "—"
                  : `${context.entry.volumeRatio.toFixed(1)}× average`
              }
            />
            <Reading
              label="Range"
              value={
                context.entry.zone
                  ? rangeLabel(context.entry.zone, context.entry.rangePosition)
                  : "—"
              }
            />
            <Reading
              label="Support"
              value={
                context.entry.support === null ? "—" : formatNumber(String(context.entry.support))
              }
            />
            <Reading
              label="Resistance"
              value={
                context.entry.resistance === null
                  ? "—"
                  : formatNumber(String(context.entry.resistance))
              }
            />
            <Reading
              label="Zones at entry"
              value={
                context.entry.zones.length
                  ? context.entry.zones
                      .map(
                        (z) =>
                          `${z.direction.toLowerCase()} ${z.kind === "FVG" ? "FVG" : z.kind.toLowerCase().replace("_", " ")}`,
                      )
                      .join(", ")
                  : "None"
              }
            />
          </dl>

          <div>
            <h3 className="mb-2 text-xs font-medium tracking-wide text-ink-faint uppercase">
              Entry checklist
            </h3>
            <ul className="grid gap-2">
              {context.checks
                .filter((c) => c.phase === "ENTRY")
                .map((c) => (
                  <CheckRow key={c.code} c={c} />
                ))}
            </ul>
          </div>

          {context.excursion && (
            <div>
              <h3 className="mb-2 text-xs font-medium tracking-wide text-ink-faint uppercase">
                Exit
              </h3>
              <dl className="mb-3 grid grid-cols-3 gap-4">
                <Reading
                  label="Best move"
                  value={`${formatNumber(String(context.excursion.mfe))}${context.excursion.mfeR !== null ? ` (${context.excursion.mfeR}R)` : ""}`}
                />
                <Reading
                  label="Worst move"
                  value={`${formatNumber(String(context.excursion.mae))}${context.excursion.maeR !== null ? ` (${context.excursion.maeR}R)` : ""}`}
                />
                <Reading label="Kept" value={formatPercent(context.excursion.efficiency, 0)} />
              </dl>
              <ul className="grid gap-2">
                {context.checks
                  .filter((c) => c.phase === "EXIT")
                  .map((c) => (
                    <CheckRow key={c.code} c={c} />
                  ))}
              </ul>
            </div>
          )}
          <p className="text-[11px] text-ink-faint">
            Computed from exchange candles that had closed before your entry (no hindsight).{" "}
            <Link href="/help#strategy" className="underline underline-offset-2 hover:text-ink">
              How each item is defined
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}

/** Position in the latest swing range; outside the range it says so instead of showing −136%. */
function rangeLabel(zone: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM", pos: number | null): string {
  const name = zone.charAt(0) + zone.slice(1).toLowerCase();
  if (pos === null) return name;
  if (pos < 0) return "Below range";
  if (pos > 1) return "Above range";
  return `${name} (${formatPercent(pos, 0)})`;
}
