import {
  DESK_DISCLAIMER,
  DESK_FREE_SYMBOL,
  DESK_REFRESH_MINUTES,
  DESK_SHORT,
  DESK_SYMBOLS,
  type DeskSymbol,
  deskQuerySchema,
  type MarketDeskResponse,
} from "@atc/shared";
import { CandlestickChart, Lock } from "lucide-react";
import Link from "next/link";
import { Panel } from "@/features/analytics/metric";
import {
  AlignmentCard,
  DriverCard,
  MarketCard,
  NextEventCard,
  RecentReleases,
  SummaryCard,
} from "@/features/desk/views";
import { AutoRefresh } from "@/features/labs/backtest-views";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

export const metadata = { title: "Market Context Desk" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Market Context Desk: what is driving BTC, ETH, SOL, gold and silver right now, driver by driver,
 * with the evidence, the next high-impact release and the trader's own open positions. No verdict.
 */
export default async function DeskPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const parsed = deskQuerySchema.safeParse({
    symbol: typeof raw.s === "string" ? raw.s : undefined,
  });
  const symbol: DeskSymbol = parsed.success ? parsed.data.symbol : DESK_FREE_SYMBOL;
  const res = await apiFetch<MarketDeskResponse>(`/v1/market/desk?symbol=${symbol}`);

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-6">
      <AutoRefresh every={5 * 60_000} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Market Context Desk</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            What is moving the market right now, explained driver by driver with the numbers behind
            it, next to your own open trades. Context to check before you click, not a call.
          </p>
        </div>
        <p className="text-xs text-ink-faint">Recomputed every {DESK_REFRESH_MINUTES} minutes</p>
      </header>

      <nav aria-label="Markets" className="flex flex-wrap gap-2">
        {DESK_SYMBOLS.map((s) => {
          const locked = !res.allowed.includes(s);
          return (
            <Link
              key={s}
              href={`/desk?s=${s}`}
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
              The free plan includes the Bitcoin desk. Ethereum, Solana, gold and silver come with
              Pro and Premium.
            </p>
            <div className="flex gap-4">
              <Link href="/billing" className="text-coach underline-offset-4 hover:underline">
                See plans
              </Link>
              <Link
                href={`/desk?s=${DESK_FREE_SYMBOL}`}
                className="text-coach underline-offset-4 hover:underline"
              >
                Open the Bitcoin desk
              </Link>
            </div>
          </div>
        </Panel>
      )}

      {res.status === "unavailable" && (
        <Panel title="Being prepared">
          <p className="text-sm text-ink-muted">
            The first desk for this market is being built. It appears within {DESK_REFRESH_MINUTES}{" "}
            minutes; this page refreshes by itself.
          </p>
        </Panel>
      )}

      {res.status === "ok" && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <MarketCard desk={res.desk} />
            <NextEventCard event={res.desk.nextEvent} />
            <AlignmentCard rows={res.alignment} />
          </div>
          <SummaryCard desk={res.desk} />
          <section aria-label="Drivers" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {res.desk.drivers.map((d) => (
              <DriverCard key={d.key} driver={d} />
            ))}
          </section>
          <RecentReleases events={res.desk.recentEvents} />
        </>
      )}

      <p className="text-xs text-ink-faint">{DESK_DISCLAIMER}</p>
    </div>
  );
}
