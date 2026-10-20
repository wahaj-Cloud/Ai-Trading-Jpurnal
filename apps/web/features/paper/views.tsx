import {
  formatPrice,
  PAPER_EXIT_LABEL,
  type PaperBotDto,
  type PaperBreakdownRow,
  type PaperStats,
  type PaperTradeDto,
  SCALP_ALERT_DIRECTION_LABEL,
  signedFixed,
  signedPct,
  signedUsd,
} from "@atc/shared";
import Link from "next/link";
import { Metric } from "@/features/analytics/metric";
import { coinName } from "@/features/orderflow/format";
import { cn } from "@/lib/cn";

const tone = (v: number | null | undefined) =>
  v === null || v === undefined || v === 0 ? "" : v > 0 ? "text-profit" : "text-loss";
const money = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The bot's rule in one line. */
export function ruleText(b: PaperBotDto): string {
  const entry =
    b.source === "COCKPIT"
      ? `${b.minCount}+ Cockpit readings ${SCALP_ALERT_DIRECTION_LABEL[b.direction]} on ${b.tf}${b.noNews ? ", not around news" : ""}`
      : `"${b.setupName ?? "deleted setup"}" matches on ${b.tf}`;
  return `${entry} · stop ${b.stopRanges} ranges, target ${b.targetR}R, out after ${b.maxHoldMin} min · ${b.riskPct}% risk · ${b.feeBps} bps fee, ${b.slippageBps} bps slippage`;
}

export function MaturityBanner({ bot }: { bot: PaperBotDto }) {
  return (
    <p
      className={cn(
        "rounded-[var(--radius-control)] px-3 py-2 text-sm",
        bot.maturity.ready ? "bg-profit/10 text-ink" : "bg-coach/10 text-ink",
      )}
    >
      {bot.maturity.text}
    </p>
  );
}

export function StatsGrid({ s, startEquity }: { s: PaperStats; startEquity: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      <Metric
        label="Net result"
        value={<span className={tone(s.netPnl)}>{signedUsd(s.netPnl)}</span>}
        hint={`${signedPct(s.returnPct)} of ${money(startEquity)}`}
      />
      <Metric
        label="Trades"
        value={s.trades}
        hint={s.trades ? `${s.wins} won · ${s.losses} lost` : "none closed yet"}
      />
      <Metric
        label="Win rate"
        value={s.winRatePct === null ? "—" : `${s.winRatePct.toFixed(1)}%`}
      />
      <Metric
        label="Average trade"
        value={
          <span className={tone(s.avgR)}>
            {s.avgR === null ? "—" : `${signedFixed(s.avgR, 2)}R`}
          </span>
        }
        hint={s.expectancyUsd === null ? undefined : signedUsd(s.expectancyUsd)}
      />
      <Metric
        label="Profit factor"
        value={s.profitFactor === null ? "—" : s.profitFactor.toFixed(2)}
        hint="won ÷ lost"
      />
      <Metric
        label="Deepest drop"
        value={`${s.maxDrawdownPct.toFixed(1)}%`}
        hint={`Fees ${money(s.fees)} · funding ${signedUsd(-s.funding)}`}
      />
    </div>
  );
}

export function BotCard({ bot }: { bot: PaperBotDto }) {
  const s = bot.stats;
  return (
    <Link
      href={`/lab/paper/${bot.id}`}
      className="surface grid gap-3 rounded-[var(--radius-surface)] p-4 transition-colors hover:bg-hi/[0.03]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">
          {bot.name}{" "}
          <span className="text-sm font-normal text-ink-muted">· {coinName(bot.symbol)}</span>
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px]",
            bot.enabled ? "bg-profit/15 text-profit" : "bg-hi/10 text-ink-faint",
          )}
        >
          {bot.enabled ? (bot.open ? "In a trade" : "Watching") : "Paused"}
        </span>
      </div>
      <p className="text-xs text-ink-faint">{ruleText(bot)}</p>
      <dl className="figures grid grid-cols-4 gap-2 text-sm">
        <div>
          <dt className="text-xs text-ink-faint">Net</dt>
          <dd className={tone(s.netPnl)}>{signedUsd(s.netPnl)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">Trades</dt>
          <dd>{s.trades}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">Win rate</dt>
          <dd>{s.winRatePct === null ? "—" : `${Math.round(s.winRatePct)}%`}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">Avg</dt>
          <dd className={tone(s.avgR)}>{s.avgR === null ? "—" : `${signedFixed(s.avgR, 2)}R`}</dd>
        </div>
      </dl>
      <p className="text-xs text-ink-muted">{bot.maturity.text}</p>
    </Link>
  );
}

export function OpenTrade({ t }: { t: PaperTradeDto }) {
  return (
    <div className="figures flex flex-wrap gap-x-6 gap-y-1 rounded-[var(--radius-control)] bg-hi/[0.04] px-3 py-2 text-sm">
      <span className={t.side === "LONG" ? "text-profit" : "text-loss"}>
        {t.side === "LONG" ? "Long" : "Short"} {t.qty.toPrecision(4)}
      </span>
      <span>Entry {formatPrice(t.entryPrice)}</span>
      <span className="text-loss">Stop {formatPrice(t.stop)}</span>
      <span className="text-profit">Target {formatPrice(t.target)}</span>
      <span className="text-ink-muted">Risk {money(t.riskUsd)}</span>
      {t.funding !== 0 && <span className="text-ink-muted">Funding {signedUsd(-t.funding)}</span>}
    </div>
  );
}

export function Breakdown({ title, rows }: { title: string; rows: PaperBreakdownRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="grid content-start gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <table className="figures w-full text-sm">
        <thead className="text-xs text-ink-faint">
          <tr>
            <th className="text-left font-normal" />
            <th className="pl-3 text-right font-normal">Trades</th>
            <th className="pl-3 text-right font-normal">Win</th>
            <th className="pl-3 text-right font-normal">Avg</th>
            <th className="pl-3 text-right font-normal">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-rule">
              <td className="py-1.5">{r.label}</td>
              <td className="pl-3 text-right">{r.trades}</td>
              <td className="pl-3 text-right">
                {r.winRatePct === null ? "—" : `${Math.round(r.winRatePct)}%`}
              </td>
              <td className={cn("pl-3 text-right", tone(r.avgR))}>
                {r.avgR === null ? "—" : `${signedFixed(r.avgR, 2)}R`}
              </td>
              <td className={cn("pl-3 text-right", tone(r.netPnl))}>{signedUsd(r.netPnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

function noteText(t: PaperTradeDto): string {
  const n = t.entryNote;
  if (!n) return "";
  return n.kind === "cockpit"
    ? `${Math.max(n.up, n.down)} of ${n.total} readings`
    : n.matched.slice(0, 3).join(" · ");
}

export function TradesTable({ trades }: { trades: PaperTradeDto[] }) {
  if (trades.length === 0)
    return (
      <p className="text-sm text-ink-muted">
        No trades yet. The bot enters the moment its rule starts holding.
      </p>
    );
  return (
    <div className="overflow-x-auto">
      <table className="figures w-full min-w-[760px] text-sm">
        <thead className="text-xs text-ink-faint">
          <tr className="text-right">
            <th className="text-left font-normal">Opened (UTC)</th>
            <th className="text-left font-normal">Side</th>
            <th className="font-normal">Entry</th>
            <th className="font-normal">Exit</th>
            <th className="text-left font-normal pl-3">Why out</th>
            <th className="font-normal">Fees + funding</th>
            <th className="font-normal">Result</th>
            <th className="font-normal">R</th>
            <th className="text-left font-normal pl-3">At entry</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id} className="border-t border-rule text-right">
              <td className="py-1.5 text-left">{when(t.entryAt)}</td>
              <td className={cn("text-left", t.side === "LONG" ? "text-profit" : "text-loss")}>
                {t.side === "LONG" ? "Long" : "Short"}
              </td>
              <td>{formatPrice(t.entryPrice)}</td>
              <td>{t.exitPrice === null ? "open" : formatPrice(t.exitPrice)}</td>
              <td className="pl-3 text-left text-ink-muted">
                {t.exitReason ? PAPER_EXIT_LABEL[t.exitReason] : "—"}
              </td>
              <td className="text-ink-muted">{money(t.fees + t.funding)}</td>
              <td className={tone(t.pnl)}>{t.pnl === null ? "—" : signedUsd(t.pnl)}</td>
              <td className={tone(t.rMultiple)}>
                {t.rMultiple === null ? "—" : signedFixed(t.rMultiple, 2)}
              </td>
              <td className="max-w-[16rem] truncate pl-3 text-left text-xs text-ink-faint">
                {noteText(t)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
