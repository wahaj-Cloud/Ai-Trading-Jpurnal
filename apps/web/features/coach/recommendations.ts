import {
  type AnalyticsDto,
  BEHAVIOURS,
  type BehaviourSummaryDto,
  type BucketDto,
  SESSIONS,
  type SessionId,
} from "@atc/shared";
import { formatMoney, formatPercent, formatPnl } from "@/features/trades/format";

/**
 * Rule-based improvement suggestions from the trader's own numbers. They need no AI, so they work
 * on every plan and even when the AI coach is switched off; each one names the figure behind it
 * and one concrete next step.
 */
export interface Recommendation {
  id: string;
  tone: "warn" | "good" | "tip";
  title: string;
  detail: string;
  /** Money at stake, used to rank (bigger first). */
  weight: number;
  action?: { label: string; href: string };
}

/** Below this many closed trades the patterns are mostly noise. */
export const MIN_TRADES_FOR_ADVICE = 10;

const ask = (q: string) => `/coach?q=${encodeURIComponent(q)}`;
const n = (v: string | null | undefined) => Number(v ?? 0);

function worst(buckets: BucketDto[], minTrades: number): BucketDto | null {
  return (
    buckets
      .filter((b) => b.trades >= minTrades && n(b.pnl) < 0)
      .sort((a, b) => n(a.pnl) - n(b.pnl))[0] ?? null
  );
}
function best(buckets: BucketDto[], minTrades: number): BucketDto | null {
  return (
    buckets
      .filter((b) => b.trades >= minTrades && n(b.pnl) > 0)
      .sort((a, b) => n(b.pnl) - n(a.pnl))[0] ?? null
  );
}

export function buildRecommendations(
  report: AnalyticsDto | null,
  habits: BehaviourSummaryDto | null,
  limit = 5,
): Recommendation[] {
  const s = report?.summary;
  if (!report || !s || s.trades < MIN_TRADES_FOR_ADVICE) return [];
  const out: Recommendation[] = [];
  const avgWin = n(s.avgWin);
  const avgLoss = n(s.avgLoss);

  // 1. Winning often but losing more on each loser: the classic "holding losers" profile.
  if (s.winRate !== null && s.winRate >= 0.5 && avgWin > 0 && avgLoss > avgWin * 1.2) {
    out.push({
      id: "payoff",
      tone: "warn",
      title: "You win often, but your losses are bigger than your wins",
      detail: `You win ${formatPercent(s.winRate, 0)} of trades, yet an average loss (${formatMoney(String(avgLoss))}) is ${(avgLoss / avgWin).toFixed(1)}× an average win (${formatMoney(String(avgWin))}). Place a stop loss before entering and don't move it further away.`,
      weight: (avgLoss - avgWin) * s.losses,
      action: { label: "Plan stops with the risk/reward calculator", href: "/calculators" },
    });
  }

  // 2. The system as a whole loses.
  if (s.profitFactor !== null && s.profitFactor < 1 && s.trades >= 20) {
    out.push({
      id: "profit-factor",
      tone: "warn",
      title: "Your trading loses money overall right now",
      detail: `For every 1 you make you give back ${(1 / s.profitFactor).toFixed(2)} (profit factor ${s.profitFactor.toFixed(2)}). Trade smaller until it is above 1.2, and journal every losing trade this week.`,
      weight: n(s.grossLoss) - n(s.grossProfit),
      action: {
        label: "Ask the coach what to change",
        href: ask("My profit factor is below 1. What should I change first?"),
      },
    });
  }

  // 3. A session that costs money, and the one that pays.
  const sessionRows = report.bySession.filter((b) => b.key in SESSIONS);
  const badSession = worst(sessionRows, 5);
  if (badSession) {
    out.push({
      id: `session-${badSession.key}`,
      tone: "warn",
      title: `Avoid the ${SESSIONS[badSession.key as SessionId].label} session`,
      detail: `${badSession.trades} trades there cost you ${formatPnl(badSession.pnl)} with ${formatPercent(badSession.winRate, 0)} won. Try not trading it for two weeks and compare.`,
      weight: Math.abs(n(badSession.pnl)),
      action: { label: "See your sessions", href: "/analytics" },
    });
  }
  const goodSession = best(sessionRows, 5);
  if (goodSession) {
    out.push({
      id: `session-good-${goodSession.key}`,
      tone: "good",
      title: `Focus on the ${SESSIONS[goodSession.key as SessionId].label} session`,
      detail: `It made ${formatPnl(goodSession.pnl)} over ${goodSession.trades} trades (${formatPercent(goodSession.winRate, 0)} won), your best time to trade.`,
      weight: n(goodSession.pnl) * 0.5,
    });
  }

  // 4. A coin that keeps losing.
  const badCoin = worst(report.bySymbol, 3);
  if (badCoin && Math.abs(n(badCoin.pnl)) >= n(s.grossLoss) * 0.15) {
    out.push({
      id: `coin-${badCoin.key}`,
      tone: "warn",
      title: `Pause trading ${badCoin.key}`,
      detail: `${badCoin.trades} trades lost ${formatPnl(badCoin.pnl)} (${formatPercent(badCoin.winRate, 0)} won), one of your biggest leaks.`,
      weight: Math.abs(n(badCoin.pnl)),
      action: {
        label: `Review ${badCoin.key} trades`,
        href: `/trades?symbol=${encodeURIComponent(badCoin.key)}`,
      },
    });
  }

  // 5. Fees eating the profit.
  const fees = Math.abs(n(s.fees));
  if (n(s.grossProfit) > 0 && fees / n(s.grossProfit) >= 0.2) {
    out.push({
      id: "fees",
      tone: "tip",
      title: `Fees take ${formatPercent(fees / n(s.grossProfit), 0)} of your winning trades`,
      detail: `You paid ${formatMoney(String(fees))} in fees. Use limit orders (maker fees are lower) and take fewer, better trades.`,
      weight: fees,
    });
  }

  // 6. Too many trades a day.
  const perDay = s.tradingDays ? s.trades / s.tradingDays : 0;
  if (perDay >= 8) {
    out.push({
      id: "overtrading",
      tone: "warn",
      title: `You average ${perDay.toFixed(0)} trades a day`,
      detail:
        "More trades usually means more fees and more impulsive entries. Set a daily trade limit and stop when you hit it.",
      weight: fees * 0.5 + perDay,
      action: { label: "Set a daily trade limit", href: "/goals" },
    });
  }

  // 7. One direction works and the other doesn't.
  const longs = report.byDirection.find((b) => b.key === "LONG");
  const shorts = report.byDirection.find((b) => b.key === "SHORT");
  if (longs && shorts && longs.trades >= 5 && shorts.trades >= 5) {
    const [good, bad] = n(longs.pnl) > n(shorts.pnl) ? [longs, shorts] : [shorts, longs];
    if (n(bad.pnl) < 0 && n(good.pnl) > 0) {
      const name = (b: BucketDto) => (b.key === "LONG" ? "longs" : "shorts");
      out.push({
        id: "direction",
        tone: "tip",
        title: `Your ${name(good)} make money, your ${name(bad)} lose it`,
        detail: `${name(good)}: ${formatPnl(good.pnl)} · ${name(bad)}: ${formatPnl(bad.pnl)}. Take ${name(bad)} only with your strongest setups, or at half size.`,
        weight: Math.abs(n(bad.pnl)),
      });
    }
  }

  // 8. The behaviour that costs the most.
  const habit = habits?.costByBehaviour
    .filter((c) => n(c.netPnl) < 0)
    .sort((a, b) => n(a.netPnl) - n(b.netPnl))[0];
  if (habit) {
    const label = BEHAVIOURS[habit.code].label;
    out.push({
      id: `habit-${habit.code}`,
      tone: "warn",
      title: `${label} is your most expensive habit`,
      detail: `${habit.trades} trades with this pattern in the last 30 days cost ${formatPnl(habit.netPnl)}.`,
      weight: Math.abs(n(habit.netPnl)),
      action: {
        label: "Ask the coach how to stop it",
        href: ask(`How do I stop ${label.toLowerCase()}?`),
      },
    });
  }

  // 9. Currently deep in a drawdown.
  const dd = n(s.currentDrawdown);
  if (dd > 0 && dd >= n(s.maxDrawdown) * 0.6) {
    out.push({
      id: "drawdown",
      tone: "warn",
      title: "You are near your deepest drawdown",
      detail: `You are ${formatMoney(String(dd))} below your peak. Cut position size in half until you recover a third of it.`,
      weight: dd,
      action: { label: "Set a max drawdown limit", href: "/goals" },
    });
  }

  return out.sort((a, b) => b.weight - a.weight).slice(0, limit);
}
