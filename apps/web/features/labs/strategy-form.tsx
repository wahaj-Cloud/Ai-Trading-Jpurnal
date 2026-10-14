"use client";

import { type SetupDto, TIMEFRAMES } from "@atc/shared";
import { FlaskConical } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { startBacktestAction } from "./actions";

const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const TF_MINUTES: Record<(typeof TIMEFRAMES)[number], number> = {
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
};
/** Mirrors the worker's cap so the form can warn before submitting. */
const MAX_CANDLES = 600_000;

/** Start a Strategy Lab test: one saved setup, up to 5 coins, a date range and an exit plan. */
export function StrategyForm({
  setups,
  historyMonths,
}: {
  setups: SetupDto[];
  historyMonths: number;
}) {
  const now = new Date();
  const earliest = new Date(now);
  if (historyMonths >= 0) earliest.setUTCMonth(earliest.getUTCMonth() - historyMonths);
  const sixMonths = new Date(now);
  sixMonths.setUTCMonth(sixMonths.getUTCMonth() - 6);
  const [setupId, setSetupId] = useState(setups[0]?.id ?? "");
  const setup = setups.find((s) => s.id === setupId);
  const [symbols, setSymbols] = useState((setup?.symbols ?? []).slice(0, 5).join(", "));
  const [from, setFrom] = useState(dayStr(sixMonths < earliest ? earliest : sixMonths));
  const [to, setTo] = useState(dayStr(new Date(now.getTime() - 86_400_000)));
  const [stopType, setStopType] = useState<"swing" | "percent" | "atr">("swing");
  const [stopValue, setStopValue] = useState("0.1");
  const [targetR, setTargetR] = useState("2");
  const [riskPct, setRiskPct] = useState("1");
  const [slippage, setSlippage] = useState("0.05");
  const [maxHold, setMaxHold] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const list = symbols
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const candles = useMemo(() => {
    if (!setup) return 0;
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    return Math.round(((days * 1440) / TF_MINUTES[setup.timeframe]) * Math.max(1, list.length));
  }, [setup, from, to, list.length]);

  const submit = () =>
    start(async () => {
      setError(null);
      const v = Number(stopValue);
      const res = await startBacktestAction({
        setupId,
        symbols: list,
        from,
        to,
        exit: {
          stop:
            stopType === "swing"
              ? { type: "swing", bufferPct: v }
              : stopType === "percent"
                ? { type: "percent", value: v }
                : { type: "atr", multiple: v },
          targetR: Number(targetR),
          riskPct: Number(riskPct),
          slippagePct: Number(slippage),
          maxHoldCandles: maxHold.trim() ? Number(maxHold) : null,
        },
      });
      if (res && !res.ok) setError(res.message);
    });

  if (!setups.length) return null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="grid gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Setup" htmlFor="bt-setup">
          <Select
            id="bt-setup"
            value={setupId}
            onChange={(e) => {
              setSetupId(e.target.value);
              const s = setups.find((x) => x.id === e.target.value);
              setSymbols((s?.symbols ?? []).slice(0, 5).join(", "));
            }}
          >
            {setups.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.timeframe}, {s.rule.direction})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Coins (up to 5)" htmlFor="bt-symbols">
          <Input id="bt-symbols" value={symbols} onChange={(e) => setSymbols(e.target.value)} />
        </Field>
        <Field label="From" htmlFor="bt-from">
          <Input
            id="bt-from"
            type="date"
            value={from}
            min={historyMonths >= 0 ? dayStr(earliest) : undefined}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="To" htmlFor="bt-to">
          <Input
            id="bt-to"
            type="date"
            value={to}
            min={from}
            max={dayStr(now)}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Field label="Stop" htmlFor="bt-stop">
          <Select
            id="bt-stop"
            value={stopType}
            onChange={(e) => {
              const t = e.target.value as typeof stopType;
              setStopType(t);
              setStopValue(t === "swing" ? "0.1" : t === "percent" ? "1" : "1.5");
            }}
          >
            <option value="swing">Beyond the last swing (+ buffer %)</option>
            <option value="percent">Fixed % from entry</option>
            <option value="atr">ATR multiple</option>
          </Select>
        </Field>
        <Field
          label={stopType === "swing" ? "Buffer %" : stopType === "percent" ? "Stop %" : "ATR ×"}
          htmlFor="bt-stopv"
        >
          <Input
            id="bt-stopv"
            inputMode="decimal"
            value={stopValue}
            onChange={(e) => setStopValue(e.target.value)}
          />
        </Field>
        <Field label="Target (R multiple)" htmlFor="bt-target" hint="2 = twice the risk">
          <Input
            id="bt-target"
            inputMode="decimal"
            value={targetR}
            onChange={(e) => setTargetR(e.target.value)}
          />
        </Field>
        <Field label="Risk a trade (% of equity)" htmlFor="bt-risk" hint="Starting equity $10,000">
          <Input
            id="bt-risk"
            inputMode="decimal"
            value={riskPct}
            onChange={(e) => setRiskPct(e.target.value)}
          />
        </Field>
        <Field label="Slippage % a fill" htmlFor="bt-slip">
          <Input
            id="bt-slip"
            inputMode="decimal"
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
          />
        </Field>
        <Field
          label="Close after (candles)"
          htmlFor="bt-hold"
          hint="Empty = hold to stop or target"
        >
          <Input
            id="bt-hold"
            inputMode="numeric"
            placeholder="No limit"
            value={maxHold}
            onChange={(e) => setMaxHold(e.target.value)}
          />
        </Field>
      </div>
      {candles > MAX_CANDLES && (
        <p className="text-sm text-loss">
          About {candles.toLocaleString("en")} candles: too many for one test. Shorten the period or
          use fewer coins.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || candles > MAX_CANDLES || !list.length}>
          <FlaskConical className="h-4 w-4" aria-hidden="true" />
          {pending ? "Starting…" : "Run test"}
        </Button>
        <span className="text-xs text-ink-faint">
          Fees (Binance taker 0.05%), slippage and real funding are included. Entry at the next
          candle's open.
        </span>
      </div>
    </form>
  );
}
