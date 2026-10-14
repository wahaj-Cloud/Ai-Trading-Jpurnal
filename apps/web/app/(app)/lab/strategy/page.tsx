import { BACKTEST_DISCLAIMER, type BacktestRunsDto, type SetupsListDto } from "@atc/shared";
import { Lock } from "lucide-react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/features/analytics/metric";
import { AutoRefresh } from "@/features/labs/backtest-views";
import { StrategyForm } from "@/features/labs/strategy-form";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getMe } from "@/lib/me";

export const metadata = { title: "Strategy Lab" };

const STATUS: Record<string, string> = {
  QUEUED: "Waiting",
  RUNNING: "Running",
  DONE: "Done",
  FAILED: "Failed",
};

/** Strategy Lab (Premium): test a saved setup on past candles. */
export default async function StrategyLabPage() {
  const me = await getMe();
  if (me.plan.limits.backtestRunsPerMonth === 0) {
    return (
      <section className="surface grid max-w-3xl gap-4 rounded-[var(--radius-surface)] p-6">
        <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-coach uppercase">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Premium feature
        </p>
        <p className="text-lg font-semibold">Test your setup on up to 2 years of past candles.</p>
        <p className="text-sm text-ink-muted">
          Pick one of your saved setups, add a stop and target, and see every simulated trade with
          fees, slippage and real funding included. Warnings flag results that look too good to be
          true (too few trades, or a strategy fitted to the past).
        </p>
        <ButtonLink href="/billing" className="justify-self-start">
          Upgrade to Premium
        </ButtonLink>
      </section>
    );
  }
  const [runs, setups] = await Promise.all([
    apiFetch<BacktestRunsDto>("/v1/backtests"),
    apiFetch<SetupsListDto>("/v1/setups"),
  ]);
  const active = runs.items.some((r) => r.status === "QUEUED" || r.status === "RUNNING");
  return (
    <div className="grid gap-6 grid-cols-[minmax(0,1fr)]">
      {active && <AutoRefresh every={4000} />}
      <Panel
        title="New test"
        action={
          <span className="text-xs text-ink-faint">
            {runs.limit === -1
              ? "Unlimited tests"
              : `${runs.used} of ${runs.limit} tests used this month`}
          </span>
        }
      >
        {setups.items.length ? (
          <StrategyForm setups={setups.items} historyMonths={runs.historyMonths} />
        ) : (
          <div className="grid justify-items-start gap-3 text-sm text-ink-muted">
            <p>Strategy Lab tests one of your saved setups. Create your first setup to start.</p>
            <ButtonLink href="/setups/new" size="sm">
              Build a setup
            </ButtonLink>
          </div>
        )}
      </Panel>
      <Panel title="Your tests">
        {runs.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-faint">
                  <th scope="col" className="pb-2 font-medium">
                    Setup
                  </th>
                  <th scope="col" className="pb-2 font-medium">
                    Coins
                  </th>
                  <th scope="col" className="pb-2 font-medium">
                    Period
                  </th>
                  <th scope="col" className="pb-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    Trades
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    Return
                  </th>
                </tr>
              </thead>
              <tbody className="figures">
                {runs.items.map((r) => (
                  <tr key={r.id} className="border-t border-hi/10">
                    <td className="py-2">
                      <Link
                        href={`/lab/strategy/${r.id}`}
                        className="text-ink underline-offset-4 hover:underline"
                      >
                        {r.setupName}
                      </Link>{" "}
                      <span className="text-xs text-ink-faint">{r.timeframe}</span>
                    </td>
                    <td className="py-2 text-ink-muted">{r.symbols.join(", ")}</td>
                    <td className="py-2 whitespace-nowrap text-ink-muted">
                      {r.from} → {r.to}
                    </td>
                    <td className={cn("py-2", r.status === "FAILED" && "text-loss")}>
                      {STATUS[r.status]}
                      {r.status === "RUNNING" ? ` ${Math.round(r.progress * 100)}%` : ""}
                    </td>
                    <td className="py-2 text-right">{r.summary?.trades ?? "—"}</td>
                    <td
                      className={cn(
                        "py-2 text-right",
                        r.summary ? (r.summary.returnPct >= 0 ? "text-profit" : "text-loss") : "",
                      )}
                    >
                      {r.summary
                        ? `${r.summary.returnPct >= 0 ? "+" : "−"}${Math.abs(r.summary.returnPct).toFixed(2)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No tests yet.</p>
        )}
      </Panel>
      <p className="text-xs text-ink-faint">{BACKTEST_DISCLAIMER}</p>
    </div>
  );
}
