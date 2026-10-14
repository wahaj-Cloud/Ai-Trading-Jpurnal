import { EXCHANGE_CATALOG, PULSE_LINKS, pulseLink, type TradeDetailDto } from "@atc/shared";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Metric } from "@/features/analytics/metric";
import { ReviewPanel } from "@/features/coach/review-panel";
import { ExchangeMark } from "@/features/exchanges/exchange-mark";
import { JournalForm } from "@/features/journal/journal-form";
import { ContextPanel } from "@/features/strategy/context-panel";
import {
  formatDuration,
  formatMoney,
  formatNumber,
  formatPnl,
  formatR,
  formatRatio,
  isCoinAsset,
} from "@/features/trades/format";
import { getTradeDetail } from "@/features/trades/load";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getMe } from "@/lib/me";

export const metadata = { title: "Trade" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string): Promise<TradeDetailDto> {
  if (!UUID.test(id)) notFound();
  try {
    return await getTradeDetail(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}

export default async function TradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ trade: t, journal, risk, fills, setupSuggestions, review, context, contextStatus }, me] =
    await Promise.all([load(id), getMe()]);
  const when = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: me.timezone,
  });
  const time = new Intl.DateTimeFormat("en", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: me.timezone,
  });
  const source = t.accountLabel ?? EXCHANGE_CATALOG[t.exchange].name;

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div>
        <Link href="/trades" className="text-sm text-ink-muted hover:text-ink">
          Trades
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{t.symbol}</h1>
          <span
            className={cn(
              "rounded px-2 py-0.5 text-sm font-medium",
              t.direction === "LONG" ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss",
            )}
          >
            {t.direction === "LONG" ? "Long" : "Short"}
          </span>
          {t.leverage && (
            <span className="figures text-sm text-ink-muted">{formatNumber(t.leverage)}x</span>
          )}
          {t.status === "OPEN" && (
            <span className="rounded border border-coach px-2 py-0.5 text-xs text-coach">Open</span>
          )}
          {t.planned && (
            <Link
              href="/setups"
              title="Opened soon after one of your setup alerts"
              className="rounded bg-coach/15 px-2 py-0.5 text-xs font-medium text-coach"
            >
              Planned setup
            </Link>
          )}
          {t.btcCorrAtEntry !== null && (
            <Link
              href={`/market/${t.symbol}`}
              title="24-hour correlation of this coin to BTC when you entered"
              className="figures rounded bg-hi/10 px-2 py-0.5 text-xs text-ink-muted"
            >
              {PULSE_LINKS[pulseLink(t.btcCorrAtEntry)]} ({t.btcCorrAtEntry.toFixed(2)}) at entry
            </Link>
          )}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
          <ExchangeMark exchange={t.exchange} size="xs" />
          {source} · opened {when.format(new Date(t.openedAt))}
          {t.closedAt ? ` · closed ${when.format(new Date(t.closedAt))}` : ""} · held{" "}
          {formatDuration(t.holdingSeconds)}
        </p>
      </div>

      {t.incompleteHistory && (
        <p className="flex gap-2 rounded-[var(--radius-control)] border border-rule bg-raised px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-coach" aria-hidden="true" />
          This position opened before the history the exchange shares with us, so the entry price is
          derived from the exchange's reported profit.
        </p>
      )}

      <section aria-label="Result" className="rounded-[var(--radius-surface)] surface p-5 sm:p-6">
        <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4 lg:grid-cols-8">
          <div className="col-span-2">
            <Metric
              label={isCoinAsset(t.settleAsset) ? `Net P&L (${t.settleAsset})` : "Net P&L"}
              value={formatPnl(t.netPnl, t.settleAsset)}
              signed={t.netPnl}
              size="lg"
              hint={
                t.grossPnl
                  ? `Gross ${formatPnl(t.grossPnl, t.settleAsset)} · fees −${formatPnl(t.fees ?? "0", t.settleAsset).replace("+", "")} · funding ${formatPnl(t.funding ?? "0", t.settleAsset)}`
                  : undefined
              }
            />
          </div>
          <Metric label="Entry" value={formatNumber(t.entryPrice)} />
          <Metric label="Exit" value={formatNumber(t.exitPrice)} />
          <Metric label="Size" value={`${formatNumber(t.quantity)} ${t.sizeAsset}`} />
          <Metric
            label="Result in R"
            value={formatR(risk.rMultiple)}
            signed={risk.rMultiple === null ? undefined : String(risk.rMultiple)}
            hint={risk.riskAmount ? `Risked ${formatMoney(risk.riskAmount)}` : "Add a stop below"}
          />
          <Metric
            label="Planned R:R"
            value={
              risk.plannedRewardRisk === null ? "—" : `${formatRatio(risk.plannedRewardRisk)} : 1`
            }
          />
          <Metric label="Source" value={t.source === "CSV" ? "Imported" : "Synced"} />
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <section
          aria-labelledby="journal-heading"
          className="rounded-[var(--radius-surface)] surface p-5 sm:p-6"
        >
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="journal-heading" className="font-semibold">
              Your review
            </h2>
            {journal && (
              <p className="text-xs text-ink-faint">
                Last saved {when.format(new Date(journal.updatedAt))}
              </p>
            )}
          </div>
          <JournalForm
            positionId={t.id}
            journal={journal}
            setupSuggestions={setupSuggestions}
            quoteAsset={t.quoteAsset}
          />
        </section>

        <div className="grid content-start gap-6">
          {review ? (
            <ReviewPanel positionId={t.id} review={review} />
          ) : (
            <section className="rounded-[var(--radius-surface)] surface p-5 text-sm text-ink-muted sm:p-6">
              The coach reviews trades once they are closed.
            </section>
          )}
          {t.status === "CLOSED" && (
            <ContextPanel
              positionId={t.id}
              context={context}
              status={contextStatus}
              marketData={EXCHANGE_CATALOG[t.exchange].kind !== "METATRADER"}
            />
          )}

          {journal && journal.screenshotUrls.length > 0 && (
            <section
              aria-labelledby="shots-heading"
              className="rounded-[var(--radius-surface)] surface p-5 sm:p-6"
            >
              <h2 id="shots-heading" className="font-semibold">
                Charts
              </h2>
              <ul className="mt-3 grid gap-2 text-sm">
                {journal.screenshotUrls.map((u) => (
                  <li key={u} className="truncate">
                    <a
                      href={u}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-ink underline decoration-rule underline-offset-4 hover:decoration-coach"
                    >
                      {new URL(u).hostname}
                      {new URL(u).pathname}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {fills.length > 0 && (
            <section
              aria-labelledby="fills-heading"
              className="rounded-[var(--radius-surface)] surface p-5 sm:p-6"
            >
              <h2 id="fills-heading" className="font-semibold">
                Executions
              </h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-ink-muted">
                    <tr className="border-b border-rule">
                      <th scope="col" className="py-2 pr-2 font-medium">
                        Time
                      </th>
                      <th scope="col" className="py-2 pr-2 font-medium">
                        Side
                      </th>
                      <th scope="col" className="py-2 pr-2 text-right font-medium">
                        Price
                      </th>
                      <th scope="col" className="py-2 text-right font-medium">
                        Size
                      </th>
                    </tr>
                  </thead>
                  <tbody className="figures">
                    {fills.map((f) => (
                      <tr
                        key={`${f.id}-${f.role}`}
                        className="border-b border-rule/60 last:border-0"
                      >
                        <td className="py-1.5 pr-2 text-ink-muted">
                          {time.format(new Date(f.executedAt))}
                        </td>
                        <td className="py-1.5 pr-2">
                          {f.side === "BUY" ? "Buy" : "Sell"}
                          <span className="text-ink-faint">
                            {f.role === "OPEN" ? " · open" : " · close"}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-right">{formatNumber(f.price)}</td>
                        <td className="py-1.5 text-right">{formatNumber(f.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
