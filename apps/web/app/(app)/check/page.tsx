import {
  CHECK_DISCLAIMER,
  DESK_FREE_SYMBOL,
  DESK_SHORT,
  DESK_SYMBOLS,
  type DeskSymbol,
  type TradeCheckResponse,
  tradeCheckQuerySchema,
} from "@atc/shared";
import { CandlestickChart, Lock } from "lucide-react";
import Link from "next/link";
import { Panel } from "@/features/analytics/metric";
import {
  FactorGroups,
  FlagsCard,
  MissingNote,
  RangeCard,
  RecordCard,
  TallyCard,
} from "@/features/check/views";
import { LivePrice } from "@/features/desk/live-price";
import { AutoRefresh } from "@/features/labs/backtest-views";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

export const metadata = { title: "Trade Check" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Trade Check: every reading professionals check before a position, for one market, judged by
 * fixed rules and counted; plus the trader's own record in the same conditions. No call.
 */
export default async function TradeCheckPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const parsed = tradeCheckQuerySchema.safeParse({
    symbol: typeof raw.s === "string" ? raw.s : undefined,
  });
  const symbol: DeskSymbol = parsed.success ? parsed.data.symbol : DESK_FREE_SYMBOL;
  const res = await apiFetch<TradeCheckResponse>(`/v1/market/check?symbol=${symbol}`);

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-6">
      <AutoRefresh every={5 * 60_000} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trade Check</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Everything professionals look at before a long or a short (trend, crowd mood, futures
            positioning, US spot demand, options and macro) on one page. Each reading shows which
            side it supports and why, then your own record in the same conditions.
          </p>
        </div>
        <p className="text-xs text-ink-faint">Readings refresh every 15 minutes</p>
      </header>

      <nav aria-label="Markets" className="flex flex-wrap gap-2">
        {DESK_SYMBOLS.map((s) => {
          const locked = !res.allowed.includes(s);
          return (
            <Link
              key={s}
              href={`/check?s=${s}`}
              scroll={false}
              aria-current={s === symbol ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-sm transition-colors",
                s === symbol
                  ? "border-coach/60 bg-coach/15 font-medium text-ink"
                  : "border-rule text-ink-muted hover:bg-hi/[0.06] hover:text-ink",
              )}
            >
              {DESK_SHORT[s]}
              {locked && <Lock className="h-3 w-3" aria-label="Pro" />}
            </Link>
          );
        })}
        <Link
          href={`/live?s=${symbol}`}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-ink-muted hover:text-ink"
        >
          <CandlestickChart className="h-4 w-4" aria-hidden="true" />
          Open chart
        </Link>
      </nav>

      {res.status === "locked" && (
        <Panel title="Every market on Pro">
          <div className="grid justify-items-start gap-3 text-sm text-ink-muted">
            <p>
              The free plan includes Trade Check for Bitcoin. Ethereum, Solana, gold and silver come
              with Pro and Premium.
            </p>
            <div className="flex gap-4">
              <Link href="/billing" className="text-coach underline-offset-4 hover:underline">
                See plans
              </Link>
              <Link
                href={`/check?s=${DESK_FREE_SYMBOL}`}
                className="text-coach underline-offset-4 hover:underline"
              >
                Open Bitcoin
              </Link>
            </div>
          </div>
        </Panel>
      )}

      {res.status === "unavailable" && (
        <Panel title="Being prepared">
          <p className="text-sm text-ink-muted">
            The first readings for this market are being collected. They appear within 15 minutes;
            this page refreshes by itself.
          </p>
        </Panel>
      )}

      {res.status === "ok" && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <TallyCard
              check={res.check}
              price={
                res.check.price !== null ? (
                  <LivePrice symbol={symbol} price={res.check.price} change24hPct={null} />
                ) : null
              }
            />
            <FlagsCard check={res.check} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <RangeCard check={res.check} />
            <div className="lg:col-span-2">
              <RecordCard record={res.record} name={res.check.name} />
            </div>
          </div>
          <FactorGroups factors={res.check.factors} />
          <MissingNote missing={res.check.missing} />
        </>
      )}

      <p className="text-xs text-ink-faint">{CHECK_DISCLAIMER}</p>
    </div>
  );
}
