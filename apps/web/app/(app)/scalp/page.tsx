import { SCALP_DISCLAIMER, type ScalpResponse } from "@atc/shared";
import { AutoRefresh } from "@/features/labs/backtest-views";
import { ScalpBoard } from "@/features/scalp/live-board";
import { SCALP_FILTERS, type ScalpFilter } from "@/features/scalp/views";
import { apiFetch } from "@/lib/api";

export const metadata = { title: "Scalping" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * Scalping desk: the selected coin on every timeframe from 5 minutes to a day, its order book near
 * price and its distance from today's VWAP, then every coin in one strength grid. Live every second
 * (open interest every 5 seconds) through the live stream.
 */
export default async function ScalpPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const data = await apiFetch<ScalpResponse>("/v1/market/scalp");
  const filterParam = one(raw.f);
  const filter: ScalpFilter = SCALP_FILTERS.some((f) => f.id === filterParam)
    ? (filterParam as ScalpFilter)
    : "all";

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-6">
      {/* The figures are live; a reload every 2 minutes refreshes the parts that are not. */}
      <AutoRefresh every={120_000} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scalping</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            Who is pushing right now in crypto, gold and silver, on every timeframe from 5 minutes
            to a day: buying and selling strength, volatility, key levels, unusual volume, the order
            book near price and news risk.
          </p>
        </div>
      </header>

      <ScalpBoard
        initial={data}
        wanted={one(raw.s)?.toUpperCase() ?? null}
        filter={filter}
        renderedAt={Date.now()}
      />
      <p className="text-xs text-ink-faint">{SCALP_DISCLAIMER}</p>
    </div>
  );
}
