import {
  BACKTEST_DISCLAIMER,
  type BacktestRunDto,
  type BacktestTradesPage,
  describeCondition,
  type SetupDto,
  signedFixed,
  signedPct,
  signedUsd,
} from "@atc/shared";
import { AlertTriangle, Download, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Metric, Panel } from "@/features/analytics/metric";
import { LineChart } from "@/features/charts/line-chart";
import { AutoRefresh, BacktestTrades, DeleteBacktestButton } from "@/features/labs/backtest-views";
import { ApiError, apiFetch } from "@/lib/api";

export const metadata = { title: "Backtest" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pct = (v: number | null, dp = 1) => (v === null ? "—" : `${(v * 100).toFixed(dp)}%`);
const usd = (v: number) => signedUsd(v);

export default async function BacktestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const run = await apiFetch<BacktestRunDto>(`/v1/backtests/${id}`).catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  });
  const running = run.status === "QUEUED" || run.status === "RUNNING";
  const [trades, setup] = await Promise.all([
    run.status === "DONE"
      ? apiFetch<BacktestTradesPage>(`/v1/backtests/${id}/trades?limit=100`)
      : Promise.resolve(null),
    run.setupId
      ? apiFetch<SetupDto>(`/v1/setups/${run.setupId}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  const s = run.summary;
  const exit = run.exit;
  const stop =
    exit.stop.type === "swing"
      ? `beyond the last swing + ${exit.stop.bufferPct}%`
      : exit.stop.type === "percent"
        ? `${exit.stop.value}% from entry`
        : `${exit.stop.multiple} × ATR`;

  return (
    <div className="grid gap-6 grid-cols-[minmax(0,1fr)]">
      {running && <AutoRefresh />}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/lab/strategy" className="text-sm text-ink-muted hover:text-ink">
            ← Strategy Lab
          </Link>
          <h2 className="mt-1 text-xl font-semibold">
            {run.setupName}{" "}
            <span className="text-sm font-normal text-ink-muted">
              {run.timeframe} · {run.symbols.join(", ")} · {run.from} → {run.to}
            </span>
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Stop {stop}, target {exit.targetR}R, risking {exit.riskPct}% of $
            {exit.startEquity.toLocaleString("en")} a trade, {exit.slippagePct}% slippage
            {exit.maxHoldCandles ? `, closed after ${exit.maxHoldCandles} candles` : ""}.
          </p>
          {setup && (
            <p className="mt-1 text-xs text-ink-faint">
              Rule now: {setup.rule.all.map(describeCondition).join(" · ")} (results use the rule as
              it was when the test started)
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {run.status === "DONE" && (
            <a
              href={`/lab/strategy/${run.id}/download`}
              className="inline-flex h-8 items-center gap-2 rounded-full px-3 text-sm text-ink-muted hover:bg-hi/10 hover:text-ink"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              CSV
            </a>
          )}
          {!running && <DeleteBacktestButton id={run.id} />}
        </div>
      </header>

      {running && (
        <section
          className="surface grid gap-3 rounded-[var(--radius-surface)] p-6"
          aria-live="polite"
        >
          <p className="font-semibold">
            {run.status === "QUEUED"
              ? "Waiting for a free slot…"
              : "Downloading candles and simulating…"}
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-hi/10">
            <div
              className="h-full bg-coach transition-[width]"
              style={{ width: `${Math.max(3, run.progress * 100)}%` }}
            />
          </div>
          <p className="text-sm text-ink-muted">
            The first test on a coin downloads its history once; later tests reuse it and finish in
            seconds. You can leave this page.
          </p>
        </section>
      )}

      {run.status === "FAILED" && (
        <section role="alert" className="surface rounded-[var(--radius-surface)] p-6 text-sm">
          <p className="font-semibold text-loss">The test could not finish.</p>
          <p className="mt-1 text-ink-muted">
            {run.error ?? "Unknown error."} It did not count towards your monthly tests.
          </p>
        </section>
      )}

      {s && (
        <>
          {s.warnings.length > 0 && (
            <section className="grid gap-2 rounded-[var(--radius-surface)] border border-[#f59e0b]/40 bg-[#f59e0b]/10 p-4 text-sm">
              {s.warnings.map((w) => (
                <p key={w} className="flex gap-2">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-[#f59e0b]"
                    aria-hidden="true"
                  />
                  {w}
                </p>
              ))}
            </section>
          )}
          <dl className="surface grid grid-cols-2 gap-5 rounded-[var(--radius-surface)] p-5 sm:grid-cols-4 2xl:grid-cols-8">
            <Metric label="Net result" value={usd(s.netPnl)} signed={String(s.netPnl)} />
            <Metric label="Return" value={signedPct(s.returnPct, 2)} signed={String(s.returnPct)} />
            <Metric label="Trades" value={s.trades} hint={`${s.wins} won · ${s.losses} lost`} />
            <Metric label="Win rate" value={pct(s.winRate)} />
            <Metric label="Profit factor" value={s.profitFactor?.toFixed(2) ?? "—"} />
            <Metric
              label="Average R"
              value={s.avgR === null ? "—" : `${signedFixed(s.avgR, 2)}R`}
            />
            <Metric label="Max drawdown" value={`${s.maxDrawdownPct.toFixed(2)}%`} />
            <Metric
              label="Fees + funding"
              value={usd(-(s.fees + s.funding))}
              hint={`fees ${usd(-s.fees)}`}
            />
          </dl>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Panel title="Equity">
              <LineChart
                label="Simulated equity after each trade"
                format="usd"
                series={[
                  {
                    name: "Equity (USD)",
                    colorVar: "--color-coach",
                    fallback: "#7c8cff",
                    points: s.equity.map((p) => ({ t: p.t / 1000, v: p.equity })),
                  },
                ]}
              />
            </Panel>
            <Panel title="Consistency check">
              <dl className="grid gap-3 text-sm">
                {(
                  [
                    ["First 70% of the period", s.split.first],
                    ["Last 30% of the period", s.split.last],
                  ] as const
                ).map(([label, x]) => (
                  <div key={label} className="grid gap-0.5">
                    <dt className="text-ink-muted">{label}</dt>
                    <dd className="figures">
                      {x.trades} trades · win rate {pct(x.winRate)} · average{" "}
                      {x.expectancyR === null ? "—" : `${signedFixed(x.expectancyR, 2)}R`}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-ink-faint">
                A setup that only worked early in the period may be fitted to past conditions.
              </p>
            </Panel>
          </div>
          <Panel
            title="Simulated trades"
            action={
              trades?.nextCursor ? (
                <span className="text-xs text-ink-faint">
                  First 100 shown · download the CSV for all
                </span>
              ) : undefined
            }
          >
            {trades?.items.length ? (
              <BacktestTrades runId={run.id} trades={trades.items} />
            ) : (
              <p className="text-sm text-ink-muted">
                The setup never matched in this period. Try more coins, a longer period, or looser
                conditions (the setup preview shows how often it fires).
              </p>
            )}
          </Panel>
          <Link
            href={`/coach?q=${encodeURIComponent(
              `My Strategy Lab test of "${run.setupName}" (${run.timeframe}, ${run.symbols.join(", ")}, ${run.from} to ${run.to}): ${s.trades} trades, win rate ${pct(s.winRate)}, average ${s.avgR?.toFixed(2) ?? "n/a"}R, max drawdown ${s.maxDrawdownPct.toFixed(1)}%, first 70% average ${s.split.first.expectancyR ?? "n/a"}R vs last 30% ${s.split.last.expectancyR ?? "n/a"}R. How should I read this, and what should I watch for before trading it live?`,
            )}`}
            className="inline-flex items-center gap-2 text-sm text-coach underline-offset-4 hover:underline"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Ask the AI coach to explain this result
          </Link>
        </>
      )}
      <p className="text-xs text-ink-faint">{BACKTEST_DISCLAIMER}</p>
    </div>
  );
}
