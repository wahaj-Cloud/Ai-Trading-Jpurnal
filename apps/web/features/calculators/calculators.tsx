"use client";

import { type ReactNode, useId, useState } from "react";
import { Field, Input, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import {
  expectancy,
  kelly,
  monteCarlo,
  positionSize,
  recoveryNeeded,
  requiredWinRate,
  riskOfRuin,
  riskReward,
  tradeProfit,
} from "./calc";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtMoney = (n: number) => money.format(n).replace("-", "−");
const fmtNum = (n: number, d = 4) =>
  n.toLocaleString("en-US", { maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 8 : d });
const fmtPct = (n: number, d = 1) => `${n.toFixed(d)}%`;

/** A numeric input whose value lives as text so the user can type freely ("0.", "-"). */
function useNum(initial: string) {
  const [text, setText] = useState(initial);
  return { text, setText, value: text.trim() === "" ? Number.NaN : Number(text) };
}

function NumField({
  label,
  hint,
  state,
  suffix,
}: {
  label: string;
  hint?: string;
  state: ReturnType<typeof useNum>;
  suffix?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          value={state.text}
          onChange={(e) => state.setText(e.target.value)}
          className={cn("figures", suffix && "pr-10")}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink-faint">
            {suffix}
          </span>
        )}
      </div>
    </Field>
  );
}

type Tone = "profit" | "loss" | "coach" | undefined;
const TONE: Record<NonNullable<Tone>, string> = {
  profit: "text-profit",
  loss: "text-loss",
  coach: "text-coach",
};

function Results({ rows, empty }: { rows: Array<[string, string, Tone?]> | null; empty?: string }) {
  return (
    <div
      className="rounded-[var(--radius-control)] border border-rule bg-raised/40 p-4"
      aria-live="polite"
    >
      {rows ? (
        <dl className="grid gap-2">
          {rows.map(([label, value, tone], i) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-ink-muted">{label}</dt>
              <dd
                className={cn(
                  "figures font-semibold",
                  i === 0 ? "text-xl" : "text-sm",
                  tone && TONE[tone],
                )}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-ink-faint">
          {empty ?? "Fill in every field to see the result."}
        </p>
      )}
    </div>
  );
}

function Card({ title, blurb, children }: { title: string; blurb: string; children: ReactNode }) {
  return (
    <section className="surface grid content-start gap-4 rounded-[var(--radius-surface)] p-5">
      <header>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-ink-muted">{blurb}</p>
      </header>
      {children}
    </section>
  );
}

const twoCols = "grid gap-3 sm:grid-cols-2";

function PositionSizeCalc() {
  const balance = useNum("10000");
  const risk = useNum("1");
  const entry = useNum("60000");
  const stop = useNum("59400");
  const lev = useNum("10");
  const r = positionSize(balance.value, risk.value, entry.value, stop.value, lev.value);
  return (
    <Card
      title="Position size"
      blurb="How much to buy so a stopped-out trade costs exactly your planned risk."
    >
      <div className={twoCols}>
        <NumField label="Account balance" state={balance} suffix="$" />
        <NumField label="Risk per trade" state={risk} suffix="%" />
        <NumField label="Entry price" state={entry} />
        <NumField label="Stop loss" state={stop} />
        <NumField label="Leverage" state={lev} suffix="×" />
      </div>
      <Results
        rows={
          r && [
            ["Quantity", fmtNum(r.quantity)],
            ["Money at risk", fmtMoney(r.riskAmount), "loss"],
            ["Position value", fmtMoney(r.notional)],
            ["Margin needed", fmtMoney(r.margin)],
          ]
        }
      />
    </Card>
  );
}

function RiskRewardCalc() {
  const entry = useNum("100");
  const stop = useNum("95");
  const target = useNum("112.5");
  const r = riskReward(entry.value, stop.value, target.value);
  return (
    <Card title="Risk / reward" blurb="What you stand to win for every dollar you risk.">
      <div className="grid gap-3 sm:grid-cols-3">
        <NumField label="Entry" state={entry} />
        <NumField label="Stop loss" state={stop} />
        <NumField label="Take profit" state={target} />
      </div>
      <Results
        empty="Stop and target must be on opposite sides of the entry."
        rows={
          r && [
            [
              "Ratio",
              `1 : ${r.ratio.toFixed(2)}`,
              r.ratio >= 2 ? "profit" : r.ratio < 1 ? "loss" : undefined,
            ],
            ["Break-even win rate", fmtPct(r.breakevenWinRate)],
          ]
        }
      />
    </Card>
  );
}

function ProfitCalc() {
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const entry = useNum("100");
  const exit = useNum("108");
  const qty = useNum("10");
  const fee = useNum("0.05");
  const sideId = useId();
  const r = tradeProfit(side, entry.value, exit.value, qty.value, fee.value);
  return (
    <Card title="Profit" blurb="Net result of a trade after exchange fees on both entry and exit.">
      <div className={twoCols}>
        <Field label="Direction" htmlFor={sideId}>
          <Select
            id={sideId}
            value={side}
            onChange={(e) => setSide(e.target.value as "LONG" | "SHORT")}
          >
            <option value="LONG">Long</option>
            <option value="SHORT">Short</option>
          </Select>
        </Field>
        <NumField label="Quantity" state={qty} />
        <NumField label="Entry price" state={entry} />
        <NumField label="Exit price" state={exit} />
        <NumField label="Fee per side" hint="Binance taker is 0.05%" state={fee} suffix="%" />
      </div>
      <Results
        rows={
          r && [
            ["Net profit", fmtMoney(r.net), r.net >= 0 ? "profit" : "loss"],
            ["Gross", fmtMoney(r.gross)],
            ["Fees", fmtMoney(r.fees)],
            ["Return on position", fmtPct(r.returnPct, 2)],
          ]
        }
      />
    </Card>
  );
}

function DrawdownCalc() {
  const dd = useNum("25");
  const r = recoveryNeeded(dd.value);
  return (
    <Card
      title="Drawdown recovery"
      blurb="Losses hurt more than they look: the gain needed to get back to your peak."
    >
      <NumField label="Drawdown" state={dd} suffix="%" />
      <Results
        empty="Enter a drawdown between 0 and 99.99%."
        rows={r === null ? null : [["Gain needed to recover", fmtPct(r), "coach"]]}
      />
    </Card>
  );
}

function ExpectancyCalc() {
  const wr = useNum("45");
  const win = useNum("150");
  const loss = useNum("100");
  const e = expectancy(wr.value, win.value, loss.value);
  return (
    <Card
      title="Expectancy"
      blurb="What one trade is worth on average. Positive means you have an edge."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <NumField label="Win rate" state={wr} suffix="%" />
        <NumField label="Average win" state={win} suffix="$" />
        <NumField label="Average loss" state={loss} suffix="$" />
      </div>
      <Results
        rows={
          e === null
            ? null
            : [
                ["Per trade", fmtMoney(e), e >= 0 ? "profit" : "loss"],
                ["Per 100 trades", fmtMoney(e * 100)],
              ]
        }
      />
    </Card>
  );
}

function WinRateCalc() {
  const rr = useNum("2");
  const r = requiredWinRate(rr.value);
  return (
    <Card
      title="Required win rate"
      blurb="The minimum win rate to break even at a given reward-to-risk."
    >
      <NumField
        label="Reward-to-risk"
        hint="2 means you aim to win 2× what you risk"
        state={rr}
        suffix="R"
      />
      <Results rows={r === null ? null : [["Break-even win rate", fmtPct(r), "coach"]]} />
    </Card>
  );
}

function KellyCalc() {
  const wr = useNum("50");
  const rr = useNum("2");
  const k = kelly(wr.value, rr.value);
  return (
    <Card
      title="Kelly criterion"
      blurb="The mathematically optimal risk per trade. Use a quarter to half of it."
    >
      <div className={twoCols}>
        <NumField label="Win rate" state={wr} suffix="%" />
        <NumField label="Reward-to-risk" state={rr} suffix="R" />
      </div>
      <Results
        rows={
          k === null
            ? null
            : k <= 0
              ? [["Full Kelly", "No edge — don't risk", "loss"]]
              : [
                  ["Full Kelly", fmtPct(k)],
                  ["Half Kelly", fmtPct(k / 2), "coach"],
                  ["Quarter Kelly", fmtPct(k / 4)],
                ]
        }
      />
    </Card>
  );
}

function RuinCalc() {
  const wr = useNum("50");
  const rr = useNum("1.5");
  const risk = useNum("2");
  const ruin = useNum("50");
  const r = riskOfRuin(wr.value, rr.value, risk.value, ruin.value);
  return (
    <Card
      title="Risk of ruin"
      blurb="Chance of a drawdown big enough to end your account, at a fixed risk per trade."
    >
      <div className={twoCols}>
        <NumField label="Win rate" state={wr} suffix="%" />
        <NumField label="Reward-to-risk" state={rr} suffix="R" />
        <NumField label="Risk per trade" state={risk} suffix="%" />
        <NumField
          label="Counts as ruin"
          hint="Account loss you could not recover from"
          state={ruin}
          suffix="%"
        />
      </div>
      <Results
        rows={
          r === null
            ? null
            : [
                [
                  "Risk of ruin",
                  r < 0.01 ? "< 0.01%" : fmtPct(r, 2),
                  r > 5 ? "loss" : r < 1 ? "profit" : undefined,
                ],
              ]
        }
      />
    </Card>
  );
}

function MonteCarloCalc() {
  const balance = useNum("10000");
  const wr = useNum("50");
  const rr = useNum("1.5");
  const risk = useNum("1");
  const trades = useNum("100");
  const r = monteCarlo(balance.value, wr.value, rr.value, risk.value, trades.value, 2000);
  return (
    <Card
      title="Monte Carlo"
      blurb="2,000 simulated futures of your strategy: the range of where your balance could end up."
    >
      <div className={twoCols}>
        <NumField label="Starting balance" state={balance} suffix="$" />
        <NumField label="Number of trades" state={trades} />
        <NumField label="Win rate" state={wr} suffix="%" />
        <NumField label="Reward-to-risk" state={rr} suffix="R" />
        <NumField label="Risk per trade" state={risk} suffix="%" />
      </div>
      <Results
        rows={
          r && [
            ["Median outcome", fmtMoney(r.median), r.median >= balance.value ? "profit" : "loss"],
            ["Bad case (10%)", fmtMoney(r.p10)],
            ["Good case (90%)", fmtMoney(r.p90)],
            ["Typical worst drawdown", fmtPct(r.medianMaxDrawdownPct)],
            ["Chance of ending down", fmtPct(r.lossChancePct)],
          ]
        }
      />
    </Card>
  );
}

const GROUPS = [
  { id: "trade", label: "Plan a trade", items: [PositionSizeCalc, RiskRewardCalc, ProfitCalc] },
  { id: "edge", label: "Your edge", items: [ExpectancyCalc, WinRateCalc, KellyCalc] },
  { id: "risk", label: "Risk", items: [DrawdownCalc, RuinCalc, MonteCarloCalc] },
] as const;

export function Calculators() {
  const [group, setGroup] = useState<(typeof GROUPS)[number]["id"]>("trade");
  const active = GROUPS.find((g) => g.id === group) ?? GROUPS[0];
  return (
    <div className="grid gap-6">
      <div role="tablist" aria-label="Calculator groups" className="flex flex-wrap gap-2">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={g.id === group}
            onClick={() => setGroup(g.id)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm transition-colors",
              g.id === group
                ? "border-coach bg-coach/15 text-ink shadow-[0_0_16px_-6px_rgb(61_139_255/0.8)]"
                : "border-rule text-ink-muted hover:bg-raised hover:text-ink",
            )}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="grid items-start gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {active.items.map((C) => (
          <C key={C.name} />
        ))}
      </div>
    </div>
  );
}
