import type { OpenPositionsDto } from "@atc/shared";
import { LiveMarkets } from "@/features/live/live-markets";
import { LIVE_INTERVALS, type LiveInterval } from "@/features/live/market";
import { apiFetch } from "@/lib/api";

export const metadata = { title: "Live Markets" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Live Markets: live prices for the top 100 futures coins and a live chart with your positions. */
export default async function LivePage({ searchParams }: { searchParams: SearchParams }) {
  const p = await searchParams;
  const raw = typeof p.s === "string" ? p.s.toUpperCase() : "BTCUSDT";
  const symbol = /^[A-Z0-9]{2,20}USDT$/.test(raw) ? raw : "BTCUSDT";
  const tf =
    typeof p.tf === "string" && (LIVE_INTERVALS as readonly string[]).includes(p.tf)
      ? (p.tf as LiveInterval)
      : "15m";
  const open = await apiFetch<OpenPositionsDto>("/v1/open-positions").catch(() => null);
  return (
    <div className="mx-auto grid max-w-[96rem] grid-cols-[minmax(0,1fr)] gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Live Markets</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Live prices for Bitcoin, gold, silver and the top 100 futures markets, straight from
          Binance. Draw on the chart, add indicators, and see your open positions with live profit
          or loss and the time left on every candle.
        </p>
      </header>
      <LiveMarkets symbol={symbol} interval={tf} positions={open?.items ?? []} />
      <p className="text-xs text-ink-faint">
        Market data from Binance's public feed. Your open positions refresh with each sync; their
        live profit is estimated from the Binance price and may differ slightly from your exchange.
      </p>
    </div>
  );
}
