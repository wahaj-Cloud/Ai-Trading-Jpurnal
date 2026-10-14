"use client";

import {
  EMOTIONS,
  MISTAKES,
  type WhatIfFiltersInput,
  type WhatIfResultDto,
  type WhatIfScenarioDto,
} from "@atc/shared";
import { Bookmark, Play, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { LineChart } from "@/features/charts/line-chart";
import { formatMoney, formatPercent, formatPnl, formatRatio } from "@/features/trades/format";
import { cn } from "@/lib/cn";
import { deleteScenarioAction, runWhatIfAction, saveScenarioAction } from "./actions";
import { whatIfHeadline } from "./headline";

type Filters = Required<{
  [K in keyof WhatIfFiltersInput]: Exclude<WhatIfFiltersInput[K], undefined>;
}>;

const EMPTY: Filters = {
  range: "90d",
  stopAfterLosses: null,
  maxDailyLoss: null,
  maxTradesPerDay: null,
  skipTags: [],
  sessions: [],
  weekdays: [],
  symbols: [],
  directions: [],
  onlyPlanned: false,
  riskCapUsd: null,
};

const RANGES = [
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "365d", label: "1 year" },
  { id: "all", label: "All" },
] as const;
const SESSIONS = [
  { id: "ASIA", label: "Asia" },
  { id: "LONDON", label: "London" },
  { id: "NEW_YORK", label: "New York" },
  { id: "OFF_HOURS", label: "Off-hours" },
] as const;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TAGS: Array<[string, string]> = [
  ["FOMO", EMOTIONS.FOMO],
  ["REVENGE", EMOTIONS.REVENGE],
  ["OVERTRADING", MISTAKES.OVERTRADING],
  ["CHASED_ENTRY", MISTAKES.CHASED_ENTRY],
  ["NO_PLAN", MISTAKES.NO_PLAN],
  ["NO_STOP", MISTAKES.NO_STOP],
  ["OVERSIZED", MISTAKES.OVERSIZED],
  ["AGAINST_TREND", MISTAKES.AGAINST_TREND],
  ["BROKE_RULES", MISTAKES.BROKE_RULES],
  ["GREED", EMOTIONS.GREED],
  ["IMPATIENT", EMOTIONS.IMPATIENT],
];

function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-3 text-sm whitespace-nowrap transition-colors",
        on
          ? "border-coach/60 bg-coach/15 font-medium text-ink"
          : "border-rule text-ink-muted hover:bg-hi/[0.06] hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

const toggleIn = <T,>(list: readonly T[], v: T): T[] =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
const numOrNull = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-xs font-medium tracking-wide text-ink-faint uppercase">
        {title}
      </legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

export function WhatIfLab({
  scenarios: initialScenarios,
  goalDailyLoss,
  goalMaxTrades,
}: {
  scenarios: WhatIfScenarioDto[];
  goalDailyLoss: string | null;
  goalMaxTrades: number | null;
}) {
  const [f, setF] = useState<Filters>({ ...EMPTY, stopAfterLosses: 2 });
  const [symbolsText, setSymbolsText] = useState("");
  const [result, setResult] = useState<{ result: WhatIfResultDto; currency: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState(initialScenarios);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));

  const current = (): Filters => ({
    ...f,
    symbols: symbolsText
      .split(/[\s,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  });
  const run = (filters: Filters = current()) =>
    start(async () => {
      setError(null);
      const res = await runWhatIfAction(filters);
      if (res.ok) setResult(res.data);
      else setError(res.message);
    });
  const load = (s: WhatIfScenarioDto) => {
    setF({ ...EMPTY, ...s.filters });
    setSymbolsText(s.filters.symbols.join(", "));
    run({ ...EMPTY, ...s.filters });
  };
  const save = () =>
    start(async () => {
      const res = await saveScenarioAction(name, current());
      if (res.ok) {
        setScenarios((x) => [...x, res.data]);
        setName("");
      } else setError(res.message);
    });
  const remove = (id: string) =>
    start(async () => {
      const res = await deleteScenarioAction(id);
      if (res.ok) setScenarios((x) => x.filter((s) => s.id !== id));
    });

  const r = result?.result;
  const cur = result?.currency ?? "USD";
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <section
        aria-label="Your rules"
        className="surface grid content-start gap-5 rounded-[var(--radius-surface)] p-5"
      >
        <Group title="Period">
          {RANGES.map((x) => (
            <Toggle key={x.id} on={f.range === x.id} onClick={() => set("range", x.id)}>
              {x.label}
            </Toggle>
          ))}
        </Group>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Stop after losses in a row" htmlFor="wi-losses">
            <Input
              id="wi-losses"
              inputMode="numeric"
              placeholder="Off"
              value={f.stopAfterLosses ?? ""}
              onChange={(e) => set("stopAfterLosses", numOrNull(e.target.value))}
            />
          </Field>
          <Field
            label="Daily loss limit ($)"
            htmlFor="wi-loss"
            hint={goalDailyLoss ? `Your goal: $${goalDailyLoss}` : undefined}
          >
            <Input
              id="wi-loss"
              inputMode="decimal"
              placeholder="Off"
              value={f.maxDailyLoss ?? ""}
              onChange={(e) => set("maxDailyLoss", numOrNull(e.target.value))}
            />
          </Field>
          <Field
            label="Max trades a day"
            htmlFor="wi-trades"
            hint={goalMaxTrades ? `Your goal: ${goalMaxTrades}` : undefined}
          >
            <Input
              id="wi-trades"
              inputMode="numeric"
              placeholder="Off"
              value={f.maxTradesPerDay ?? ""}
              onChange={(e) => set("maxTradesPerDay", numOrNull(e.target.value))}
            />
          </Field>
          <Field label="Max risk a trade ($)" htmlFor="wi-risk" hint="Needs a stop in the journal">
            <Input
              id="wi-risk"
              inputMode="decimal"
              placeholder="Off"
              value={f.riskCapUsd ?? ""}
              onChange={(e) => set("riskCapUsd", numOrNull(e.target.value))}
            />
          </Field>
        </div>
        <Group title="Skip trades tagged">
          {TAGS.map(([code, label]) => (
            <Toggle
              key={code}
              on={f.skipTags.includes(code)}
              onClick={() => set("skipTags", toggleIn(f.skipTags, code))}
            >
              {label}
            </Toggle>
          ))}
        </Group>
        <Group title="Only these sessions">
          {SESSIONS.map((s) => (
            <Toggle
              key={s.id}
              on={f.sessions.includes(s.id)}
              onClick={() => set("sessions", toggleIn(f.sessions, s.id))}
            >
              {s.label}
            </Toggle>
          ))}
        </Group>
        <Group title="Only these days">
          {WEEKDAYS.map((d, i) => (
            <Toggle
              key={d}
              on={f.weekdays.includes(i)}
              onClick={() => set("weekdays", toggleIn(f.weekdays, i))}
            >
              {d}
            </Toggle>
          ))}
        </Group>
        <Group title="Direction">
          {(["LONG", "SHORT"] as const).map((d) => (
            <Toggle
              key={d}
              on={f.directions.includes(d)}
              onClick={() => set("directions", toggleIn(f.directions, d))}
            >
              {d === "LONG" ? "Longs only" : "Shorts only"}
            </Toggle>
          ))}
          <Toggle on={f.onlyPlanned} onClick={() => set("onlyPlanned", !f.onlyPlanned)}>
            Only planned (setup alert)
          </Toggle>
        </Group>
        <Field
          label="Only these coins"
          htmlFor="wi-symbols"
          hint="Comma separated, e.g. BTCUSDT, ETHUSDT"
        >
          <Input
            id="wi-symbols"
            placeholder="All coins"
            value={symbolsText}
            onChange={(e) => setSymbolsText(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => run()} disabled={pending}>
            <Play className="h-4 w-4" aria-hidden="true" />
            {pending ? "Replaying…" : "Replay my trades"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setF(EMPTY);
              setSymbolsText("");
            }}
          >
            Clear
          </Button>
        </div>
        <div className="grid gap-2 border-t border-hi/10 pt-4">
          <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">
            Saved scenarios
          </p>
          {scenarios.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {scenarios.map((s) => (
                <li key={s.id} className="inline-flex items-center rounded-full border border-rule">
                  <button
                    type="button"
                    onClick={() => load(s)}
                    className="h-8 rounded-l-full pr-1 pl-3 text-sm text-ink hover:bg-hi/[0.06]"
                  >
                    {s.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(s.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-r-full text-ink-faint hover:text-loss"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">Delete {s.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">Save rules you want to check again later.</p>
          )}
          <div className="flex gap-2">
            <Input
              aria-label="Scenario name"
              placeholder="e.g. My London rules"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={save}
              disabled={pending || !name.trim()}
            >
              <Bookmark className="h-4 w-4" aria-hidden="true" />
              Save
            </Button>
          </div>
        </div>
      </section>

      <section aria-label="Result" aria-live="polite" className="grid content-start gap-5">
        {error && (
          <p role="alert" className="surface rounded-[var(--radius-surface)] p-4 text-sm text-loss">
            {error}
          </p>
        )}
        {!r ? (
          <div className="surface grid gap-2 rounded-[var(--radius-surface)] p-6 text-sm text-ink-muted">
            <p className="text-base font-semibold text-ink">
              What if you had followed your own rules?
            </p>
            <p>
              Pick the rules on the left and replay your real trades. The lab only removes or scales
              down trades you actually took, so every number comes from your journal. Nothing is
              invented.
            </p>
          </div>
        ) : (
          <>
            <div className="surface rounded-[var(--radius-surface)] p-5">
              <p
                className={cn(
                  "text-lg font-semibold",
                  Number(r.difference.netPnl) > 0
                    ? "text-profit"
                    : Number(r.difference.netPnl) < 0
                      ? "text-loss"
                      : "text-ink",
                )}
              >
                {whatIfHeadline(r, cur)}
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                {r.removed} of {r.actual.trades} trades left out
                {r.scaled ? `, ${r.scaled} scaled down to the risk cap` : ""}
                {r.noStop && f.riskCapUsd !== null
                  ? `, ${r.noStop} had no stop logged (unchanged)`
                  : ""}
                {r.excludedTrades
                  ? `. ${r.excludedTrades} coin-settled trades are not compared`
                  : ""}
                .
              </p>
            </div>
            <div className="surface overflow-x-auto rounded-[var(--radius-surface)] p-5">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-faint">
                    <th scope="col" className="pb-2 font-medium">
                      &nbsp;
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium">
                      What you did
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium">
                      With your rules
                    </th>
                  </tr>
                </thead>
                <tbody className="figures">
                  {[
                    ["Net P&L", formatPnl(r.actual.netPnl, cur), formatPnl(r.scenario.netPnl, cur)],
                    ["Trades", String(r.actual.trades), String(r.scenario.trades)],
                    [
                      "Win rate",
                      formatPercent(r.actual.winRate),
                      formatPercent(r.scenario.winRate),
                    ],
                    [
                      "Profit factor",
                      formatRatio(r.actual.profitFactor),
                      formatRatio(r.scenario.profitFactor),
                    ],
                    [
                      "Average per trade",
                      formatPnl(r.actual.expectancy, cur),
                      formatPnl(r.scenario.expectancy, cur),
                    ],
                    [
                      "Largest drawdown",
                      formatMoney(r.actual.maxDrawdown, cur),
                      formatMoney(r.scenario.maxDrawdown, cur),
                    ],
                  ].map(([k, a, b]) => (
                    <tr key={k} className="border-t border-hi/10">
                      <th scope="row" className="py-2 text-left font-normal text-ink-muted">
                        {k}
                      </th>
                      <td className="py-2 text-right">{a}</td>
                      <td className="py-2 text-right font-semibold text-ink">{b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r.curve.length > 1 && (
              <div className="surface rounded-[var(--radius-surface)] p-5">
                <LineChart
                  label="Cumulative net P&L: what you did vs with your rules"
                  zeroLine
                  series={[
                    {
                      name: "What you did",
                      colorVar: "--color-ink-muted",
                      fallback: "#8c99ac",
                      dashed: true,
                      points: r.curve.map((c) => ({ t: c.date, v: Number(c.actual) })),
                    },
                    {
                      name: "With your rules",
                      colorVar: "--color-coach",
                      fallback: "#7c8cff",
                      points: r.curve.map((c) => ({ t: c.date, v: Number(c.scenario) })),
                    },
                  ]}
                />
              </div>
            )}
            {r.reasons.length > 0 && (
              <div className="surface rounded-[var(--radius-surface)] p-5">
                <h3 className="mb-3 font-semibold">Trades your rules leave out</h3>
                <ul className="grid gap-2 text-sm">
                  {r.reasons.map((x) => (
                    <li key={x.reason} className="flex items-center justify-between gap-3">
                      <span className="text-ink-muted">
                        {x.reason} · {x.trades} trade{x.trades === 1 ? "" : "s"}
                      </span>
                      <span
                        className={cn("figures", Number(x.pnl) < 0 ? "text-loss" : "text-profit")}
                      >
                        {formatPnl(x.pnl, cur)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Link
              href={`/coach?q=${encodeURIComponent(`In What-If Lab, ${whatIfHeadline(r, cur)} What should I change in my routine to actually follow this?`)}`}
              className="inline-flex items-center gap-2 text-sm text-coach underline-offset-4 hover:underline"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Ask the AI coach about this
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
