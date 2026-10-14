"use client";

import { CheckCircle2, CircleAlert, CircleX } from "lucide-react";
import { useState } from "react";
import { NumField, useNum } from "@/features/calculators/calculators";
import { cn } from "@/lib/cn";
import { type CheckStatus, fmtPrice, gradeTradePlan } from "./grade-plan";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const GRADE_TONE: Record<string, string> = {
  A: "from-[#22c55e] to-[#15803d]",
  B: "from-[#84cc16] to-[#4d7c0f]",
  C: "from-[#f59e0b] to-[#b45309]",
  D: "from-[#f97316] to-[#c2410c]",
  F: "from-[#ef4444] to-[#991b1b]",
};
const STATUS_ICON: Record<CheckStatus, { icon: typeof CheckCircle2; cls: string }> = {
  good: { icon: CheckCircle2, cls: "text-profit" },
  ok: { icon: CircleAlert, cls: "text-[#f59e0b]" },
  bad: { icon: CircleX, cls: "text-loss" },
};

/** Grade a planned futures trade (rules only, runs in the browser). */
export function TradeGrader({ compact = false }: { compact?: boolean }) {
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const balance = useNum("1000");
  const entry = useNum("60000");
  const stop = useNum("59100");
  const target = useNum("62100");
  const size = useNum("600");
  const lev = useNum("10");
  const fee = useNum("0.05");
  const r = gradeTradePlan({
    side,
    balance: balance.value,
    entry: entry.value,
    stop: stop.value,
    target: target.value,
    positionUsd: size.value,
    leverage: lev.value,
    feePct: fee.value,
  });

  return (
    <div className={cn("grid items-start gap-6", !compact && "lg:grid-cols-[1fr_1.1fr]")}>
      <section
        aria-label="Your trade plan"
        className="surface grid gap-4 rounded-[var(--radius-surface)] p-5"
      >
        <div className="grid grid-cols-2 gap-1 rounded-[var(--radius-control)] border border-rule bg-well p-1">
          {(["LONG", "SHORT"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={side === s}
              onClick={() => setSide(s)}
              className={cn(
                "h-9 rounded-[9px] text-sm font-medium transition-colors",
                side === s
                  ? s === "LONG"
                    ? "bg-profit/20 text-profit"
                    : "bg-loss/20 text-loss"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {s === "LONG" ? "Long" : "Short"}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumField label="Account balance" state={balance} suffix="$" />
          <NumField label="Position size (order value)" state={size} suffix="$" />
          <NumField label="Entry price" state={entry} />
          <NumField label="Leverage" state={lev} suffix="×" />
          <NumField label="Stop loss" state={stop} />
          <NumField label="Take profit" state={target} />
          <NumField label="Fee per side" state={fee} suffix="%" hint="Taker ≈ 0.05%" />
        </div>
      </section>

      <section aria-label="Your grade" aria-live="polite" className="grid gap-4">
        {"error" in r ? (
          <div className="surface rounded-[var(--radius-surface)] p-5 text-sm text-ink-muted">
            {r.error}
          </div>
        ) : (
          <>
            <div className="surface flex items-center gap-5 rounded-[var(--radius-surface)] p-5">
              <span
                className={cn(
                  "flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b text-5xl font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_14px_30px_-12px_rgba(0,0,0,0.8)]",
                  GRADE_TONE[r.grade],
                )}
              >
                <span className="sr-only">Grade </span>
                {r.grade}
              </span>
              <div className="min-w-0">
                <p className="figures text-2xl font-semibold">
                  {r.score}
                  <span className="text-base text-ink-faint"> / 100</span>
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  Risk <span className="figures text-loss">{money(r.riskUsd)}</span> (
                  {r.riskPct.toFixed(2)}%) to make{" "}
                  <span className="figures text-profit">{money(Math.max(0, r.rewardUsd))}</span> · 1
                  : {r.rr.toFixed(2)}
                </p>
              </div>
            </div>
            <ul className="grid gap-2">
              {r.checks.map((c) => {
                const S = STATUS_ICON[c.status];
                return (
                  <li
                    key={c.id}
                    className="raised grid grid-cols-[auto_1fr_auto] gap-3 rounded-[var(--radius-control)] p-3.5"
                  >
                    <S.icon className={cn("mt-0.5 h-5 w-5", S.cls)} aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{c.label}</p>
                      <p className="mt-0.5 text-sm text-ink-muted">{c.detail}</p>
                    </div>
                    <span className="figures text-sm text-ink-faint">
                      {c.points}/{c.max}
                    </span>
                  </li>
                );
              })}
            </ul>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {[
                ["Margin needed", money(r.marginUsd)],
                ["Account leverage", `${r.effectiveLeverage.toFixed(1)}×`],
                ["Est. liquidation", fmtPrice(r.liquidationPrice)],
                ["Fees (in + out)", money(r.feesUsd)],
              ].map(([k, v]) => (
                <div key={k} className="surface rounded-[var(--radius-control)] p-3">
                  <dt className="text-xs text-ink-muted">{k}</dt>
                  <dd className="figures mt-0.5 font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </section>
    </div>
  );
}
