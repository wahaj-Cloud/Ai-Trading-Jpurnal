import { releaseUsage } from "@atc/coach";
import type { PrismaClient } from "@atc/db";
import {
  BACKTEST_USAGE_METRIC,
  type BacktestSummary,
  exitModelSchema,
  SETUP_WINDOW,
  type SetupExchange,
  type SetupTimeframe,
  setupRuleSchema,
  TAKER_FEES,
} from "@atc/shared";
import { type BacktestSeries, runBacktest, TIMEFRAME_MS } from "@atc/ta";
import { log } from "../logger.js";
import { ensureCandles, ensureFunding, type MarketDataDeps } from "../market/candle-store.js";

/** Stop a run that would simulate more than this many candles in total (keeps the worker healthy). */
const MAX_CANDLES = 600_000;
const DAY_MS = 86_400_000;

/** Runs one queued backtest: fetches market data, simulates, stores trades and the report. */
export async function processBacktest(deps: MarketDataDeps, runId: string): Promise<void> {
  const db: PrismaClient = deps.db;
  const run = await db.backtestRun.findUnique({ where: { id: runId } });
  if (!run || run.status === "DONE" || run.status === "FAILED") return;
  await db.backtestRun.update({
    where: { id: runId },
    data: { status: "RUNNING", startedAt: new Date(), progress: 0.02, error: null },
  });
  const setProgress = (p: number) =>
    db.backtestRun
      .update({ where: { id: runId }, data: { progress: Math.min(0.99, Number(p.toFixed(3))) } })
      .catch(() => undefined);

  try {
    const rule = setupRuleSchema.parse(run.rule);
    const exit = exitModelSchema.parse(run.exitModel);
    const tf = run.timeframe as SetupTimeframe;
    const step = TIMEFRAME_MS[tf];
    const exchange = run.exchange as SetupExchange;
    const from = run.fromDay.getTime();
    const to = run.toDay.getTime() + DAY_MS;
    const expected = ((to - from) / step) * run.symbols.length;
    if (expected > MAX_CANDLES)
      throw new Error("This test covers too many candles. Use a larger timeframe or fewer coins.");

    // Warm-up candles before the start so indicators are ready on day one.
    const warmFrom = from - SETUP_WINDOW * step;
    const series: BacktestSeries[] = [];
    for (const [idx, symbol] of run.symbols.entries()) {
      const candles = await ensureCandles(deps, exchange, symbol, tf, warmFrom, to, (done) =>
        setProgress(0.05 + ((idx + done) / run.symbols.length) * 0.55),
      );
      const funding = await ensureFunding(deps, exchange, symbol, from, to);
      series.push({ symbol, candles, funding });
    }
    if (series.every((s) => s.candles.length === 0))
      throw new Error("No market data for these coins in this period.");

    await setProgress(0.65);
    const { trades, summary } = runBacktest(
      series,
      { rule, exit, takerFee: TAKER_FEES[exchange], from, to },
      step,
    );
    for (let i = 0; i < trades.length; i += 1000) {
      await db.backtestTrade.createMany({
        data: trades.slice(i, i + 1000).map((t) => ({
          runId,
          symbol: t.symbol,
          side: t.side,
          entryAt: new Date(t.entryAt),
          entryPrice: t.entryPrice,
          exitAt: new Date(t.exitAt),
          exitPrice: t.exitPrice,
          exitReason: t.exitReason,
          rMultiple: t.rMultiple,
          pnl: t.pnl,
          fees: t.fees,
          funding: t.funding,
          flags: t.flags,
        })),
      });
    }
    const missing = series.filter((s) => s.candles.length === 0).map((s) => s.symbol);
    const final: BacktestSummary = missing.length
      ? {
          ...summary,
          warnings: [...summary.warnings, `No data for ${missing.join(", ")} in this period.`],
        }
      : summary;
    await db.backtestRun.update({
      where: { id: runId },
      data: {
        status: "DONE",
        progress: 1,
        summary: final as object,
        finishedAt: new Date(),
      },
    });
    log.info("backtest done", { runId, trades: trades.length });
  } catch (err) {
    const message = (err as Error).message ?? "The test failed";
    log.warn("backtest failed", { runId, err });
    await db.backtestRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        error: message.slice(0, 300),
        finishedAt: new Date(),
      },
    });
    // A run that failed on our side does not use up the monthly allowance.
    await releaseUsage(
      db,
      run.userId,
      BACKTEST_USAGE_METRIC,
      run.createdAt.toISOString().slice(0, 7),
    );
  }
}
