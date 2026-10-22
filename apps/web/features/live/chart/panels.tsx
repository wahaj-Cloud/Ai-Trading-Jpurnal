"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SidePanel } from "@/components/ui/side-panel";
import { cn } from "@/lib/cn";
import {
  CHART_TYPE_LABELS,
  CHART_TYPES,
  type ChartSettings,
  COLOR_PRESETS,
  DEFAULT_SETTINGS,
  type MaConfig,
  SD_SOURCES,
  type SdSource,
} from "./settings";
import { tfLabel } from "./zones";

type Update = (next: ChartSettings) => void;

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-ink-muted">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-coach)]"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="grid gap-1 text-xs text-ink-muted">
      {label}
      <input
        type="number"
        inputMode="decimal"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
        }}
        className="figures h-9 w-full rounded-[var(--radius-control)] border border-rule bg-canvas px-2.5 text-sm text-ink focus:border-coach focus:outline-none"
      />
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1 border-t border-rule pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold tracking-wide text-ink-faint uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Swatch({
  color,
  onChange,
  label,
}: {
  color: string;
  onChange: (c: string) => void;
  label: string;
}) {
  return (
    <label className="relative inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-control)] border border-rule">
      <span className="h-5 w-5 rounded" style={{ background: color }} />
      <input
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label={label}
      />
    </label>
  );
}

/** TradingView-style indicator picker: toggle and tune each study. */
export function IndicatorsPanel({
  open,
  onClose,
  settings: s,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  settings: ChartSettings;
  onChange: Update;
}) {
  const setMa = (id: string, patch: Partial<MaConfig>) =>
    onChange({ ...s, mas: s.mas.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Indicators"
      description="Calculated from the same candles you see, with the formulas our backtester uses."
    >
      <div className="grid gap-5">
        <Section title="Moving averages">
          {s.mas.map((m) => (
            <div
              key={m.id}
              className="grid grid-cols-[auto_5.5rem_minmax(0,1fr)_auto] items-end gap-2 py-1.5"
            >
              <input
                type="checkbox"
                checked={m.on}
                onChange={(e) => setMa(m.id, { on: e.target.checked })}
                className="mb-2.5 h-5 w-5 accent-[var(--color-coach)]"
                aria-label={`Show ${m.kind} ${m.period}`}
              />
              <label className="grid gap-1 text-xs text-ink-muted">
                Type
                <select
                  value={m.kind}
                  onChange={(e) => setMa(m.id, { kind: e.target.value as MaConfig["kind"] })}
                  className="h-9 rounded-[var(--radius-control)] border border-rule bg-canvas px-2 text-sm text-ink"
                >
                  <option value="EMA">EMA</option>
                  <option value="SMA">SMA</option>
                </select>
              </label>
              <NumberField
                label="Length"
                value={m.period}
                min={2}
                max={500}
                onChange={(v) => setMa(m.id, { period: v })}
              />
              <Swatch
                color={m.color}
                onChange={(c) => setMa(m.id, { color: c })}
                label={`${m.kind} ${m.period} colour`}
              />
            </div>
          ))}
        </Section>

        <Section title="On the price chart">
          <Toggle
            label="Volume"
            hint="Bars at the bottom, green for up candles, red for down."
            checked={s.volume}
            onChange={(v) => onChange({ ...s, volume: v })}
          />
          <Toggle
            label="VWAP"
            hint="Volume-weighted average price, restarting each day (UTC)."
            checked={s.vwap.on}
            onChange={(v) => onChange({ ...s, vwap: { on: v } })}
          />
          <Toggle
            label="Bollinger Bands"
            hint="A moving average with bands that widen when the market is volatile."
            checked={s.bollinger.on}
            onChange={(v) => onChange({ ...s, bollinger: { ...s.bollinger, on: v } })}
          />
          {s.bollinger.on && (
            <div className="grid grid-cols-2 gap-2 pb-2">
              <NumberField
                label="Length"
                value={s.bollinger.period}
                min={2}
                max={200}
                onChange={(v) => onChange({ ...s, bollinger: { ...s.bollinger, period: v } })}
              />
              <NumberField
                label="Standard deviations"
                value={s.bollinger.mult}
                min={0.5}
                max={5}
                step={0.5}
                onChange={(v) => onChange({ ...s, bollinger: { ...s.bollinger, mult: v } })}
              />
            </div>
          )}
        </Section>

        <Section title="Supply and demand zones">
          <Toggle
            label="Supply and demand zones"
            hint="Where price paused just before a strong move away: supply (red) above the price, demand (green) below. The 3 nearest each side, from closed candles. Fresh = price has not come back yet. A record of where price reacted, not a signal."
            checked={s.zones.sd}
            onChange={(v) => onChange({ ...s, zones: { ...s.zones, sd: v } })}
          />
          {s.zones.sd && (
            <label className="grid gap-1 pb-2 text-xs text-ink-muted">
              Zones from
              <select
                value={s.zones.sdTf}
                onChange={(e) =>
                  onChange({ ...s, zones: { ...s.zones, sdTf: e.target.value as SdSource } })
                }
                className="h-9 rounded-[var(--radius-control)] border border-rule bg-canvas px-2 text-sm text-ink"
              >
                {SD_SOURCES.map((tf) => (
                  <option key={tf} value={tf}>
                    {tf === "chart" ? "This chart's timeframe" : `${tfLabel(tf)} candles`}
                  </option>
                ))}
              </select>
              <span className="text-ink-faint">
                Each timeframe has its own zones, found on its own candles. A higher timeframe shows
                its zones on this chart (ignored if it is not higher than the chart).
              </span>
            </label>
          )}
        </Section>

        <Section title="Smart-money zones">
          <Toggle
            label="Fair value gaps (FVG)"
            hint="Three-candle gaps price has not traded back into yet (dashed boxes). The same detection your setup alerts use."
            checked={s.zones.fvg}
            onChange={(v) => onChange({ ...s, zones: { ...s.zones, fvg: v } })}
          />
          <Toggle
            label="Order blocks"
            hint="The last opposite candle before a break of structure, while price has not closed through it; failed blocks that flipped show as breakers."
            checked={s.zones.ob}
            onChange={(v) => onChange({ ...s, zones: { ...s.zones, ob: v } })}
          />
        </Section>

        <Section title="Liquidations">
          <Toggle
            label="Liquidation map (estimated)"
            hint="Where many positions would be liquidated, estimated from open interest on Binance, Bybit and OKX. Brighter = more value at risk."
            checked={s.liqMap.on}
            onChange={(v) => onChange({ ...s, liqMap: { ...s.liqMap, on: v } })}
          />
        </Section>

        <Section title="In their own panel">
          <Toggle
            label="RSI"
            hint="Momentum from 0 to 100; above 70 is stretched up, below 30 stretched down."
            checked={s.rsi.on}
            onChange={(v) => onChange({ ...s, rsi: { ...s.rsi, on: v } })}
          />
          {s.rsi.on && (
            <div className="grid grid-cols-2 gap-2 pb-2">
              <NumberField
                label="Length"
                value={s.rsi.period}
                min={2}
                max={100}
                onChange={(v) => onChange({ ...s, rsi: { ...s.rsi, period: v } })}
              />
            </div>
          )}
          <Toggle
            label="MACD"
            hint="Trend momentum: the gap between a fast and a slow EMA."
            checked={s.macd.on}
            onChange={(v) => onChange({ ...s, macd: { ...s.macd, on: v } })}
          />
          {s.macd.on && (
            <div className="grid grid-cols-3 gap-2 pb-2">
              <NumberField
                label="Fast"
                value={s.macd.fast}
                min={2}
                max={100}
                onChange={(v) => onChange({ ...s, macd: { ...s.macd, fast: v } })}
              />
              <NumberField
                label="Slow"
                value={s.macd.slow}
                min={3}
                max={200}
                onChange={(v) => onChange({ ...s, macd: { ...s.macd, slow: v } })}
              />
              <NumberField
                label="Signal"
                value={s.macd.signal}
                min={2}
                max={100}
                onChange={(v) => onChange({ ...s, macd: { ...s.macd, signal: v } })}
              />
            </div>
          )}
        </Section>
        <Button
          variant="secondary"
          onClick={() =>
            onChange({
              ...s,
              mas: DEFAULT_SETTINGS.mas,
              volume: DEFAULT_SETTINGS.volume,
              vwap: DEFAULT_SETTINGS.vwap,
              bollinger: DEFAULT_SETTINGS.bollinger,
              rsi: DEFAULT_SETTINGS.rsi,
              macd: DEFAULT_SETTINGS.macd,
              liqMap: DEFAULT_SETTINGS.liqMap,
              zones: DEFAULT_SETTINGS.zones,
            })
          }
        >
          Reset indicators
        </Button>
      </div>
    </SidePanel>
  );
}

/** Chart appearance, scales and time zone, like TradingView's chart settings. */
export function SettingsPanel({
  open,
  onClose,
  settings: s,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  settings: ChartSettings;
  onChange: Update;
}) {
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Chart settings"
      description="Saved on this device."
    >
      <div className="grid gap-5">
        <Section title="Chart type">
          <div className="grid grid-cols-2 gap-2">
            {CHART_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={s.type === t}
                onClick={() => onChange({ ...s, type: t })}
                className={cn(
                  "h-9 rounded-[var(--radius-control)] border px-3 text-left text-sm",
                  s.type === t
                    ? "border-coach bg-coach/10 text-ink"
                    : "border-rule text-ink-muted hover:text-ink",
                )}
              >
                {CHART_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Candle colours">
          <div className="flex flex-wrap gap-2">
            {COLOR_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                aria-pressed={s.upColor === p.up && s.downColor === p.down}
                onClick={() => onChange({ ...s, upColor: p.up, downColor: p.down })}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm",
                  s.upColor === p.up && s.downColor === p.down
                    ? "border-coach text-ink"
                    : "border-rule text-ink-muted hover:text-ink",
                )}
              >
                <span className="flex gap-0.5" aria-hidden="true">
                  <span className="h-3.5 w-2 rounded-sm" style={{ background: p.up }} />
                  <span className="h-3.5 w-2 rounded-sm" style={{ background: p.down }} />
                </span>
                {p.name}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-3 text-sm text-ink-muted">
            <Swatch
              color={s.upColor}
              onChange={(c) => onChange({ ...s, upColor: c })}
              label="Up candle colour"
            />
            Up
            <Swatch
              color={s.downColor}
              onChange={(c) => onChange({ ...s, downColor: c })}
              label="Down candle colour"
            />
            Down
          </div>
        </Section>

        <Section title="Price scale">
          <Toggle
            label="Countdown to candle close"
            hint="Time left on the current candle, under the price."
            checked={s.countdown}
            onChange={(v) => onChange({ ...s, countdown: v })}
          />
          <Toggle
            label="Last price line"
            checked={s.lastPriceLine}
            onChange={(v) => onChange({ ...s, lastPriceLine: v })}
          />
          <Toggle
            label="Logarithmic scale"
            hint="Equal distances for equal % moves; useful on long timeframes."
            checked={s.logScale}
            onChange={(v) => onChange({ ...s, logScale: v })}
          />
        </Section>

        <Section title="Canvas">
          <Toggle
            label="Grid lines"
            checked={s.grid}
            onChange={(v) => onChange({ ...s, grid: v })}
          />
          <Toggle
            label="Magnet"
            hint="Crosshair and drawings snap to candle open, high, low and close."
            checked={s.magnet}
            onChange={(v) => onChange({ ...s, magnet: v })}
          />
          <Toggle
            label="Symbol watermark"
            checked={s.watermark}
            onChange={(v) => onChange({ ...s, watermark: v })}
          />
        </Section>

        <Section title="Time zone">
          <div className="flex gap-2">
            {(
              [
                ["local", "My time zone"],
                ["utc", "UTC"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={s.timezone === v}
                onClick={() => onChange({ ...s, timezone: v })}
                className={cn(
                  "h-9 flex-1 rounded-[var(--radius-control)] border px-3 text-sm",
                  s.timezone === v
                    ? "border-coach bg-coach/10 text-ink"
                    : "border-rule text-ink-muted hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </Section>

        <Button variant="secondary" onClick={() => onChange(DEFAULT_SETTINGS)}>
          Reset all chart settings
        </Button>
      </div>
    </SidePanel>
  );
}
