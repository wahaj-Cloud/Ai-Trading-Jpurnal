"use client";

import {
  CONDITION_DEFAULTS,
  CONDITION_LABELS,
  describeCondition,
  SETUP_SESSIONS,
  SETUP_TIMEFRAMES,
  type SetupCondition,
  type SetupConditionType,
  type SetupDto,
  type SetupPreviewDto,
  type SetupTimeframe,
  SWEEP_TARGETS,
} from "@atc/shared";
import { Eye, Plus, Save, X } from "lucide-react";
import { type ReactNode, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { CandleChart } from "@/features/charts/candle-chart";
import { cn } from "@/lib/cn";
import { previewSetupAction, saveSetupAction } from "./actions";

const TYPES = Object.keys(CONDITION_LABELS) as SetupConditionType[];

function Num({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <label className="grid gap-1 text-xs text-ink-muted">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 w-24 rounded-[var(--radius-control)] border border-rule bg-canvas px-2 text-sm text-ink focus:border-coach focus:outline-none"
      />
    </label>
  );
}

function Pick<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <label className="grid gap-1 text-xs text-ink-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-9 rounded-[var(--radius-control)] border border-rule bg-canvas px-2 text-sm text-ink focus:border-coach focus:outline-none"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

const BIAS: Array<["bullish" | "bearish", string]> = [
  ["bullish", "Bullish"],
  ["bearish", "Bearish"],
];

/** Parameter editor for one condition. */
function ConditionEditor({
  c,
  onChange,
}: {
  c: SetupCondition;
  onChange: (c: SetupCondition) => void;
}): ReactNode {
  switch (c.type) {
    case "ema_trend":
      return (
        <>
          <Num
            label="Fast EMA"
            value={c.fast}
            min={2}
            max={199}
            onChange={(v) => onChange({ ...c, fast: v })}
          />
          <Num
            label="Slow EMA"
            value={c.slow}
            min={3}
            max={200}
            onChange={(v) => onChange({ ...c, slow: v })}
          />
          <Pick
            label="Fast is"
            value={c.direction}
            options={[
              ["up", "Above slow"],
              ["down", "Below slow"],
            ]}
            onChange={(v) => onChange({ ...c, direction: v })}
          />
        </>
      );
    case "price_vs_ema":
      return (
        <>
          <Pick
            label="Price is"
            value={c.side}
            options={[
              ["above", "Above"],
              ["below", "Below"],
            ]}
            onChange={(v) => onChange({ ...c, side: v })}
          />
          <Num
            label="EMA"
            value={c.period}
            min={2}
            max={200}
            onChange={(v) => onChange({ ...c, period: v })}
          />
        </>
      );
    case "rsi":
      return (
        <>
          <Num
            label="Period"
            value={c.period}
            min={2}
            max={50}
            onChange={(v) => onChange({ ...c, period: v })}
          />
          <Pick
            label="RSI is"
            value={c.op}
            options={[
              ["below", "Below"],
              ["above", "Above"],
            ]}
            onChange={(v) => onChange({ ...c, op: v })}
          />
          <Num
            label="Level"
            value={c.value}
            min={1}
            max={99}
            onChange={(v) => onChange({ ...c, value: v })}
          />
        </>
      );
    case "price_vs_vwap":
      return (
        <Pick
          label="Price is"
          value={c.side}
          options={[
            ["above", "Above VWAP"],
            ["below", "Below VWAP"],
          ]}
          onChange={(v) => onChange({ ...c, side: v })}
        />
      );
    case "liquidity_sweep":
      return (
        <>
          <Pick
            label="Swept"
            value={c.of}
            options={Object.entries(SWEEP_TARGETS) as Array<[keyof typeof SWEEP_TARGETS, string]>}
            onChange={(v) => onChange({ ...c, of: v })}
          />
          <Num
            label="Within candles"
            value={c.withinCandles}
            min={1}
            max={20}
            onChange={(v) => onChange({ ...c, withinCandles: v })}
          />
        </>
      );
    case "fvg":
      return (
        <>
          <Pick
            label="Gap"
            value={c.bias}
            options={BIAS}
            onChange={(v) => onChange({ ...c, bias: v })}
          />
          <Pick
            label="When"
            value={c.state}
            options={[
              ["formed", "Just formed"],
              ["retest", "Price retests it"],
            ]}
            onChange={(v) => onChange({ ...c, state: v })}
          />
          <Num
            label="Within candles"
            value={c.withinCandles}
            min={1}
            max={50}
            onChange={(v) => onChange({ ...c, withinCandles: v })}
          />
        </>
      );
    case "order_block":
      return (
        <>
          <Pick
            label="Block"
            value={c.bias}
            options={BIAS}
            onChange={(v) => onChange({ ...c, bias: v })}
          />
          <Num
            label="Formed within"
            value={c.withinCandles}
            min={1}
            max={100}
            onChange={(v) => onChange({ ...c, withinCandles: v })}
          />
        </>
      );
    case "structure":
      return (
        <>
          <Pick
            label="Event"
            value={c.event}
            options={[
              ["any", "BOS or CHOCH"],
              ["BOS", "BOS"],
              ["CHOCH", "CHOCH"],
            ]}
            onChange={(v) => onChange({ ...c, event: v })}
          />
          <Pick
            label="Direction"
            value={c.bias}
            options={BIAS}
            onChange={(v) => onChange({ ...c, bias: v })}
          />
          <Num
            label="Within candles"
            value={c.withinCandles}
            min={1}
            max={50}
            onChange={(v) => onChange({ ...c, withinCandles: v })}
          />
        </>
      );
    case "session":
      return (
        <div className="flex flex-wrap gap-2">
          {(Object.entries(SETUP_SESSIONS) as Array<[keyof typeof SETUP_SESSIONS, string]>).map(
            ([k, l]) => {
              const on = c.in.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = on ? c.in.filter((x) => x !== k) : [...c.in, k];
                    if (next.length) onChange({ ...c, in: next });
                  }}
                  className={cn(
                    "h-8 rounded-full border px-3 text-sm",
                    on ? "border-coach/60 bg-coach/15 text-ink" : "border-rule text-ink-muted",
                  )}
                >
                  {l}
                </button>
              );
            },
          )}
        </div>
      );
    case "volume_spike":
      return (
        <Num
          label="× average volume"
          value={c.multiple}
          min={1.1}
          max={10}
          step={0.1}
          onChange={(v) => onChange({ ...c, multiple: v })}
        />
      );
    case "premium_discount":
      return (
        <Pick
          label="Price in"
          value={c.zone}
          options={[
            ["discount", "Discount (lower half)"],
            ["premium", "Premium (upper half)"],
          ]}
          onChange={(v) => onChange({ ...c, zone: v })}
        />
      );
  }
}

/** No-code setup builder with a live preview on recent candles. */
export function SetupBuilder({ setup }: { setup?: SetupDto }) {
  const [name, setName] = useState(setup?.name ?? "");
  const [symbols, setSymbols] = useState(setup?.symbols.join(", ") ?? "BTCUSDT");
  const [timeframe, setTimeframe] = useState<SetupTimeframe>(setup?.timeframe ?? "15m");
  const [direction, setDirection] = useState<"long" | "short">(setup?.rule.direction ?? "long");
  // Each condition gets a local key so React keeps editors stable when one is removed.
  const nextKey = useRef(0);
  const keyed = (c: SetupCondition) => ({ key: nextKey.current++, c });
  const [items, setItems] = useState(() =>
    (
      setup?.rule.all ?? [
        CONDITION_DEFAULTS.liquidity_sweep,
        CONDITION_DEFAULTS.fvg,
        CONDITION_DEFAULTS.session,
      ]
    ).map(keyed),
  );
  const conditions = items.map((x) => x.c);
  const [cooldown, setCooldown] = useState(setup?.cooldownMinutes ?? 60);
  const [adding, setAdding] = useState<SetupConditionType>("ema_trend");
  const [preview, setPreview] = useState<SetupPreviewDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const symbolList = symbols
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const rule = { version: 1 as const, direction, all: conditions };

  const runPreview = () =>
    start(async () => {
      setMessage(null);
      const res = await previewSetupAction({ symbol: symbolList[0] ?? "", timeframe, rule });
      if (res.ok) setPreview(res.data);
      else setMessage(res.message);
    });
  const save = () =>
    start(async () => {
      setMessage(null);
      const res = await saveSetupAction(setup?.id ?? null, {
        name,
        symbols: symbolList,
        timeframe,
        rule,
        cooldownMinutes: cooldown,
      });
      if (res && !res.ok) setMessage(res.message);
    });

  return (
    <div className="grid gap-6 grid-cols-[minmax(0,1fr)]">
      <section className="surface grid gap-4 rounded-[var(--radius-surface)] p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name" htmlFor="su-name">
            <Input
              id="su-name"
              value={name}
              maxLength={60}
              placeholder="e.g. London OB long"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Coins (up to 10)" htmlFor="su-symbols" hint="Binance USDT perpetuals">
            <Input id="su-symbols" value={symbols} onChange={(e) => setSymbols(e.target.value)} />
          </Field>
          <Field label="Timeframe" htmlFor="su-tf">
            <Select
              id="su-tf"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as SetupTimeframe)}
            >
              {SETUP_TIMEFRAMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Direction" htmlFor="su-dir">
            <Select
              id="su-dir"
              value={direction}
              onChange={(e) => setDirection(e.target.value as "long" | "short")}
            >
              <option value="long">Long setup</option>
              <option value="short">Short setup</option>
            </Select>
          </Field>
        </div>
      </section>

      <section
        className="surface grid gap-4 rounded-[var(--radius-surface)] p-5"
        aria-label="Conditions"
      >
        <div>
          <h2 className="font-semibold">Conditions (all must be true on a closed candle)</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Checked only after each candle closes, so an alert never appears and then vanishes.
          </p>
        </div>
        <ol className="grid gap-3">
          {items.map(({ key, c }, i) => (
            <li
              key={key}
              className="grid gap-3 rounded-[var(--radius-control)] border border-rule p-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
            >
              <div>
                <p className="text-sm font-medium">{CONDITION_LABELS[c.type]}</p>
                <p className="text-xs text-ink-faint">{describeCondition(c)}</p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <ConditionEditor
                  c={c}
                  onChange={(next) =>
                    setItems((list) => list.map((x, k) => (k === i ? { ...x, c: next } : x)))
                  }
                />
              </div>
              <button
                type="button"
                onClick={() => setItems((list) => list.filter((_, k) => k !== i))}
                disabled={conditions.length === 1}
                className="inline-flex h-9 w-9 items-center justify-center justify-self-end rounded-full text-ink-faint hover:bg-hi/10 hover:text-loss disabled:opacity-30"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Remove condition</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-ink-muted">
            Add a condition
            <select
              value={adding}
              onChange={(e) => setAdding(e.target.value as SetupConditionType)}
              className="h-9 rounded-[var(--radius-control)] border border-rule bg-canvas px-2 text-sm text-ink"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {CONDITION_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={conditions.length >= 8}
            onClick={() => setItems((list) => [...list, keyed(CONDITION_DEFAULTS[adding])])}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Add
          </Button>
          <span className="text-xs text-ink-faint">Up to 8 conditions.</span>
        </div>
        <div className="flex flex-wrap items-end gap-4 border-t border-hi/10 pt-4">
          <Num
            label="Quiet time after an alert (minutes)"
            value={cooldown}
            min={0}
            max={1440}
            onChange={setCooldown}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={runPreview}
              disabled={pending || !symbolList.length}
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              Preview on {symbolList[0] ?? "a coin"}
            </Button>
            <Button
              type="button"
              onClick={save}
              disabled={pending || !name.trim() || !symbolList.length}
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {setup ? "Save changes" : "Save and start alerts"}
            </Button>
          </div>
        </div>
        {message && (
          <p role="alert" className="text-sm text-loss">
            {message}
          </p>
        )}
      </section>

      {preview && (
        <section
          className="surface grid gap-3 rounded-[var(--radius-surface)] p-5"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">
              Preview: {preview.symbol} {preview.timeframe}
            </h2>
            <p className="text-sm text-ink-muted">
              Matched {preview.matches.length} time{preview.matches.length === 1 ? "" : "s"} in the
              last {preview.candles.length} candles
              {preview.matches.length > preview.candles.length / 10
                ? " · very often: consider a stricter rule"
                : preview.matches.length === 0
                  ? " · never: consider a looser rule"
                  : ""}
            </p>
          </div>
          <CandleChart
            label={`${preview.symbol} candles with the ${preview.matches.length} places your setup matched`}
            candles={preview.candles}
            markers={preview.matches.map((m) => ({ t: m.t, kind: "match" as const }))}
          />
          <p className="text-xs text-ink-faint">
            Dots mark candles where every condition was true at the close. Alerts use exactly the
            same check.
          </p>
        </section>
      )}
    </div>
  );
}
