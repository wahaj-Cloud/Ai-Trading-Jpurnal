"use client";

import type { PaperBotsPage } from "@atc/shared";
import Link from "next/link";
import { useActionState, useState } from "react";
import { coinName } from "@/features/orderflow/format";
import { cn } from "@/lib/cn";
import { createPaperBotAction, type PaperActionState } from "./actions";

const field =
  "h-9 rounded-[var(--radius-control)] border border-rule bg-transparent px-2 text-sm text-ink";

function Num({
  name,
  label,
  defaultValue,
  min,
  max,
  step,
  suffix,
}: {
  name: string;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number | "any";
  suffix?: string;
}) {
  return (
    <label className="grid gap-1 text-xs text-ink-muted">
      {label}
      <span className="flex items-center gap-1.5">
        <input
          name={name}
          type="number"
          inputMode="decimal"
          defaultValue={defaultValue}
          min={min}
          max={max}
          step={step}
          required
          className={`${field} w-24`}
        />
        {suffix && <span className="text-ink-faint">{suffix}</span>}
      </span>
    </label>
  );
}

/** New paper bot: on a Cockpit count of readings, or on one of the trader's saved setups. */
export function CreateBotForm({ page }: { page: PaperBotsPage }) {
  const [state, action, pending] = useActionState<PaperActionState, FormData>(
    createPaperBotAction,
    { status: "idle" },
  );
  const [source, setSource] = useState<"COCKPIT" | "SETUP">("COCKPIT");
  const [setupId, setSetupId] = useState(page.setups[0]?.id ?? "");
  const setup = page.setups.find((s) => s.id === setupId);
  const full = page.limit !== -1 && page.items.length >= page.limit;

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="source" value={source} />
      <fieldset className="min-w-0 flex flex-wrap gap-2 text-sm">
        <legend className="sr-only">Entry rule</legend>
        {(
          [
            ["COCKPIT", "Cockpit readings (live, every second)"],
            ["SETUP", "One of my saved setups (on candle close)"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={source === v}
            onClick={() => setSource(v)}
            className={cn(
              "rounded-full border px-3 py-1.5",
              source === v ? "border-coach/60 bg-coach/15 text-ink" : "border-rule text-ink-muted",
            )}
          >
            {label}
          </button>
        ))}
      </fieldset>

      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-ink-muted">
          Name
          <input
            name="name"
            required
            maxLength={60}
            defaultValue={source === "COCKPIT" ? "Gold 5m count" : "My setup bot"}
            key={source}
            className={`${field} w-48`}
          />
        </label>
        {source === "COCKPIT" ? (
          <>
            <label className="grid gap-1 text-xs text-ink-muted">
              Market
              <select
                name="symbol"
                defaultValue={page.markets.includes("XAUUSDT") ? "XAUUSDT" : page.markets[0]}
                className={field}
              >
                {page.markets.map((s) => (
                  <option key={s} value={s}>
                    {coinName(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-ink-muted">
              Enter when
              <span className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
                <select name="minCount" defaultValue="7" className={field} aria-label="Readings">
                  {[4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}+
                    </option>
                  ))}
                </select>
                readings lean
                <select
                  name="direction"
                  defaultValue="ANY"
                  className={field}
                  aria-label="Direction"
                >
                  <option value="ANY">either way</option>
                  <option value="UP">up (longs only)</option>
                  <option value="DOWN">down (shorts only)</option>
                </select>
                on
                <select name="tf" defaultValue="5m" className={field} aria-label="Timeframe">
                  <option value="5m">5m</option>
                  <option value="15m">15m</option>
                </select>
              </span>
            </label>
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" name="noNews" defaultChecked className="h-4 w-4" />
              Not around news
            </label>
          </>
        ) : page.setups.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No saved setups yet.{" "}
            <Link href="/setups" className="text-coach hover:underline">
              Build one in Setup Alerts
            </Link>
            .
          </p>
        ) : (
          <>
            <label className="grid gap-1 text-xs text-ink-muted">
              Setup
              <select
                name="setupId"
                value={setupId}
                onChange={(e) => setSetupId(e.target.value)}
                className={field}
              >
                {page.setups.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.timeframe})
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-ink-muted">
              Market
              <select name="symbol" key={setupId} className={field}>
                {(setup?.symbols ?? []).map((s) => (
                  <option key={s} value={s}>
                    {coinName(s)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      <fieldset className="min-w-0 grid gap-3 rounded-[var(--radius-control)] border border-rule px-3 pt-1 pb-3">
        <legend className="px-1 text-xs text-ink-muted">Exits, size and costs</legend>
        <div className="flex flex-wrap gap-3">
          <Num
            name="stopRanges"
            label="Stop"
            defaultValue={1.5}
            min={0.3}
            max={10}
            step={0.1}
            suffix="ranges (ATR)"
          />
          <Num
            name="targetR"
            label="Target"
            defaultValue={2}
            min={0.3}
            max={10}
            step={0.1}
            suffix="R"
          />
          <Num
            name="maxHoldMin"
            label="Longest hold"
            defaultValue={source === "SETUP" ? 240 : 60}
            min={5}
            max={10080}
            step={1}
            suffix="min"
          />
          <Num
            name="riskPct"
            label="Risk per trade"
            defaultValue={1}
            min={0.1}
            max={5}
            step={0.1}
            suffix="%"
          />
          <Num
            name="startEquity"
            label="Virtual balance"
            defaultValue={10000}
            min={100}
            max={10000000}
            step="any"
            suffix="$"
          />
          <Num
            name="feeBps"
            label="Fee per fill"
            defaultValue={5}
            min={0}
            max={30}
            step={0.5}
            suffix="bps"
          />
          <Num
            name="slippageBps"
            label="Slippage"
            defaultValue={2}
            min={0}
            max={50}
            step={0.5}
            suffix="bps"
          />
        </div>
        <p className="text-xs text-ink-faint">
          The stop sits that many typical ranges of the bot's timeframe away; the target is that
          many times the stop distance. 5 bps = 0.05%, Binance's taker fee. Positions are capped at
          20× the balance.
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || full || (source === "SETUP" && page.setups.length === 0)}
          className="h-9 rounded-full bg-coach px-4 text-sm font-semibold text-coach-ink disabled:opacity-50"
        >
          {pending ? "Starting…" : "Start paper bot"}
        </button>
        {full && (
          <span className="text-xs text-ink-muted">
            Your plan keeps {page.limit} paper bot{page.limit === 1 ? "" : "s"}.{" "}
            <Link href="/billing" className="text-coach hover:underline">
              See plans
            </Link>
          </span>
        )}
        {state.message && (
          <span
            role="status"
            className={state.status === "error" ? "text-sm text-loss" : "text-sm text-profit"}
          >
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
