"use client";

import type { BacktestTradeChartDto, BacktestTradeDto } from "@atc/shared";
import { CandlestickChart, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CandleChart } from "@/features/charts/candle-chart";
import { cn } from "@/lib/cn";
import { backtestTradeChartAction, deleteBacktestAction } from "./actions";

/** Refreshes the page every few seconds while a test is queued or running. */
export function AutoRefresh({ every = 3000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), every);
    return () => clearInterval(id);
  }, [router, every]);
  return null;
}

export function DeleteBacktestButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await deleteBacktestAction(id);
            if (res && !res.ok) setError(res.message);
          })
        }
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        Delete
      </Button>
      {error && <span className="text-xs text-loss">{error}</span>}
    </span>
  );
}

const when = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});
const price = (v: number) =>
  v.toLocaleString("en", { maximumSignificantDigits: 6, minimumSignificantDigits: 2 });
const usd = (v: number) =>
  `${v < 0 ? "−" : v > 0 ? "+" : ""}$${Math.abs(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Simulated trades, each with a chart of the entry and exit on the stored candles. */
export function BacktestTrades({ runId, trades }: { runId: string; trades: BacktestTradeDto[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [chart, setChart] = useState<BacktestTradeChartDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const show = (id: string) => {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    setChart(null);
    setError(null);
    start(async () => {
      const res = await backtestTradeChartAction(runId, id);
      if (res.ok) setChart(res.data);
      else setError(res.message);
    });
  };

  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-faint">
            <th scope="col" className="pb-2 font-medium">
              Coin
            </th>
            <th scope="col" className="pb-2 font-medium">
              Side
            </th>
            <th scope="col" className="pb-2 font-medium">
              Entry (UTC)
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Entry
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Exit
            </th>
            <th scope="col" className="pb-2 pl-4 font-medium">
              Exit reason
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              R
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              P&amp;L
            </th>
            <th scope="col" className="pb-2">
              <span className="sr-only">Chart</span>
            </th>
          </tr>
        </thead>
        <tbody className="figures">
          {trades.map((t) => (
            <Fragment key={t.id}>
              <tr className="border-t border-hi/10">
                <td className="py-2">{t.symbol}</td>
                <td className={cn("py-2", t.side === "LONG" ? "text-profit" : "text-loss")}>
                  {t.side === "LONG" ? "Long" : "Short"}
                </td>
                <td className="py-2 whitespace-nowrap text-ink-muted">
                  {when.format(new Date(t.entryAt))}
                </td>
                <td className="py-2 text-right">{price(t.entryPrice)}</td>
                <td className="py-2 text-right">{price(t.exitPrice)}</td>
                <td className="py-2 pl-4 text-ink-muted">
                  {t.exitReason.toLowerCase()}
                  {t.flags.includes("stop_and_target_same_candle") && (
                    <span
                      title="Stop and target inside one candle: stop assumed first"
                      className="ml-1 text-[#f59e0b]"
                    >
                      *
                    </span>
                  )}
                </td>
                <td
                  className={cn("py-2 text-right", t.rMultiple >= 0 ? "text-profit" : "text-loss")}
                >
                  {t.rMultiple.toFixed(2)}R
                </td>
                <td className={cn("py-2 text-right", t.pnl >= 0 ? "text-profit" : "text-loss")}>
                  {usd(t.pnl)}
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    aria-expanded={open === t.id}
                    onClick={() => show(t.id)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-hi/10 hover:text-ink"
                  >
                    <CandlestickChart className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Show chart</span>
                  </button>
                </td>
              </tr>
              {open === t.id && (
                <tr>
                  <td colSpan={9} className="pb-4">
                    {pending && (
                      <p className="py-6 text-center text-sm text-ink-muted">Loading chart…</p>
                    )}
                    {error && <p className="py-4 text-sm text-loss">{error}</p>}
                    {chart && (
                      <CandleChart
                        label={`${chart.symbol} ${chart.timeframe} chart with the simulated entry and exit`}
                        height={300}
                        candles={chart.candles}
                        markers={[
                          {
                            t: chart.entryAt,
                            kind: "entry",
                            text: chart.side === "LONG" ? "Long" : "Short",
                          },
                          {
                            t: chart.candles.reduce(
                              (m, c) => (c.t <= chart.exitAt ? c.t : m),
                              chart.entryAt,
                            ),
                            kind: chart.win ? "exit-win" : "exit-loss",
                            text: "Exit",
                          },
                        ]}
                      />
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
