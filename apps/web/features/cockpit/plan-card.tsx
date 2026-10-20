"use client";

import {
  buildTradePlan,
  EXCHANGE_CATALOG,
  type ExchangeId,
  exchangeTradeUrl,
  formatPrice,
  type PlanSnapshot,
  type TradePlan,
} from "@atc/shared";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { useMounted } from "@/lib/use-mounted";

const field =
  "h-9 rounded-[var(--radius-control)] border border-rule bg-transparent px-2 text-sm text-ink";

function Copy({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* clipboard blocked: the number is on screen to copy by hand */
        }
      }}
      className="rounded-full border border-rule px-2 py-0.5 text-[11px] text-ink-muted hover:bg-hi/[0.06] hover:text-ink"
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** Plain number for pasting into an exchange (no thousands separators). */
const raw = (v: number) => formatPrice(v).replace(/,/g, "");

function Side({ plan, title }: { plan: TradePlan | null; title: string }) {
  if (!plan)
    return (
      <div className="rounded-[var(--radius-control)] bg-hi/[0.03] p-3 text-sm text-ink-muted">
        {title}: no typical range for this market yet.
      </div>
    );
  const rows: Array<[string, string, string | null, string?]> = [
    ["Entry", formatPrice(plan.entry), raw(plan.entry)],
    ["Stop", formatPrice(plan.stop), raw(plan.stop), "text-loss"],
    ["Target", formatPrice(plan.target), raw(plan.target), "text-profit"],
  ];
  if (plan.qty !== null) rows.push(["Size", String(plan.qty), String(plan.qty)]);
  return (
    <div className="grid content-start gap-2 rounded-[var(--radius-control)] bg-hi/[0.03] p-3">
      <p className="text-sm font-semibold">{title}</p>
      <dl className="figures grid gap-1.5 text-sm">
        {rows.map(([k, v, copy, tone]) => (
          <div key={k} className="flex items-center justify-between gap-2">
            <dt className="text-ink-muted">{k}</dt>
            <dd className="flex items-center gap-2">
              <span className={tone}>{v}</span>
              {copy && <Copy value={copy} label={`${title} ${k.toLowerCase()}`} />}
            </dd>
          </div>
        ))}
      </dl>
      <p className="figures text-xs text-ink-faint">
        Stop {plan.stopPct.toFixed(2)}% away · {plan.rrAfterFees.toFixed(2)}R after fees
        {plan.lossAtStopUsd !== null && plan.gainAtTargetUsd !== null && plan.notionalUsd !== null
          ? ` · −$${plan.lossAtStopUsd.toFixed(2)} at stop, +$${plan.gainAtTargetUsd.toFixed(2)} at target · $${Math.round(plan.notionalUsd).toLocaleString("en")} position`
          : ""}
      </p>
    </div>
  );
}

/**
 * One-tap trade plan: the trader's own rules (stop in typical 5-minute ranges, target in R, money
 * at risk) turned into numbers for both sides, ready to copy into their exchange. From an alert it
 * opens on the price at the moment the alert fired; it can switch to the live price. WickMentor
 * never places the order.
 */
export function PlanCard({
  symbol,
  price,
  atr5m,
  fromAlert,
  exchanges,
}: {
  symbol: string;
  price: number;
  atr5m: number | null;
  fromAlert: PlanSnapshot | null;
  /** The trader's connected venues (links open the market there). */
  exchanges: ExchangeId[];
}) {
  const local = useMounted();
  const [base, setBase] = useState<"alert" | "live">(fromAlert ? "alert" : "live");
  const [stopRanges, setStopRanges] = useState(fromAlert?.rules.stopRanges ?? 1.5);
  const [targetR, setTargetR] = useState(fromAlert?.rules.targetR ?? 2);
  const [risk, setRisk] = useState(
    fromAlert?.rules.riskUsd !== null && fromAlert?.rules.riskUsd !== undefined
      ? String(fromAlert.rules.riskUsd)
      : "",
  );
  const riskUsd = Number(risk) > 0 ? Number(risk) : null;
  const useAlert = base === "alert" && fromAlert !== null;
  const entry = useAlert ? fromAlert.entry : price;
  const range = useAlert ? fromAlert.atr5m : atr5m;
  const rules = { stopRanges, targetR, riskUsd };
  const long = buildTradePlan({ side: "LONG", price: entry, atr5m: range, rules });
  const short = buildTradePlan({ side: "SHORT", price: entry, atr5m: range, rules });
  const venues = [...new Set<ExchangeId>(exchanges.length ? exchanges : ["BINANCE"])];

  return (
    <section
      id="plan"
      aria-label="Trade plan"
      className="surface grid scroll-mt-24 gap-4 rounded-[var(--radius-surface)] p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Trade plan · your rules</h2>
        {fromAlert && (
          <fieldset className="min-w-0 flex gap-1 text-xs">
            <legend className="sr-only">Price used</legend>
            {(["alert", "live"] as const).map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={base === b}
                onClick={() => setBase(b)}
                className={cn(
                  "rounded-full border px-3 py-1",
                  base === b
                    ? "border-coach/60 bg-coach/15 text-ink"
                    : "border-rule text-ink-muted",
                )}
              >
                {b === "alert"
                  ? `Price at alert (${new Date(fromAlert.at).toLocaleTimeString("en", {
                      hour: "2-digit",
                      minute: "2-digit",
                      ...(local ? {} : { timeZone: "UTC", timeZoneName: "short" }),
                    })})`
                  : "Live price"}
              </button>
            ))}
          </fieldset>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          Stop
          <input
            type="number"
            min={0.3}
            max={10}
            step={0.1}
            value={stopRanges}
            onChange={(e) =>
              setStopRanges(Math.min(10, Math.max(0.3, Number(e.target.value) || 0.3)))
            }
            className={`${field} w-20`}
          />
          typical 5m ranges
        </label>
        <label className="flex items-center gap-2">
          Target
          <input
            type="number"
            min={0.3}
            max={10}
            step={0.5}
            value={targetR}
            onChange={(e) => setTargetR(Math.min(10, Math.max(0.3, Number(e.target.value) || 0.3)))}
            className={`${field} w-20`}
          />
          R
        </label>
        <label className="flex items-center gap-2">
          Risk $
          <input
            type="number"
            min={1}
            step="any"
            inputMode="decimal"
            value={risk}
            placeholder="optional"
            onChange={(e) => setRisk(e.target.value)}
            className={`${field} w-28`}
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Side plan={long} title="If you go long" />
        <Side plan={short} title="If you go short" />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {venues.map((v) => {
          const url = exchangeTradeUrl(v, symbol);
          return url ? (
            <a
              key={v}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-rule px-3 py-1.5 hover:bg-hi/[0.06]"
            >
              Open {EXCHANGE_CATALOG[v].name} ↗
            </a>
          ) : (
            <span key={v} className="text-xs text-ink-faint">
              {EXCHANGE_CATALOG[v].name}: enter these in your MetaTrader terminal.
            </span>
          );
        })}
      </div>
      <p className="text-xs text-ink-faint">
        Both sides from the same rules, so the direction stays your decision. Fees are a 0.05% taker
        fee on each fill; slippage is not included. WickMentor never places orders: copy the numbers
        into your exchange only if you decide to trade.
      </p>
    </section>
  );
}
