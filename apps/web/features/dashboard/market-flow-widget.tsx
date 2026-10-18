import { BIAS_TIMEFRAMES, type MarketBiasDto } from "@atc/shared";
import { Waves } from "lucide-react";
import Link from "next/link";
import { BiasChip, signedUsd, usdCompact } from "@/features/flow/views";
import { formatPrice } from "@/features/live/market";
import { cn } from "@/lib/cn";

/** Trend bias on 1D / 4H / 1H for the desk markets, with 24h whale flow and liquidations. */
export function MarketFlowWidget({ data }: { data: MarketBiasDto }) {
  return (
    <section
      aria-labelledby="flow-widget-heading"
      className="min-w-0 rounded-[var(--radius-surface)] surface p-5 sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="flow-widget-heading" className="flex items-center gap-2 font-semibold">
          <Waves className="h-4 w-4 text-coach" aria-hidden="true" />
          Trend bias and market flow
        </h2>
        <Link
          href="/flow"
          className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Whale trades and liquidations
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-faint">
              <th scope="col" className="pb-2 font-medium">
                Market
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Price
              </th>
              {BIAS_TIMEFRAMES.map((tf) => (
                <th key={tf} scope="col" className="pb-2 pl-3 font-medium">
                  {tf.toUpperCase()} bias
                </th>
              ))}
              <th scope="col" className="pb-2 text-right font-medium">
                Whales 24h
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Liquidated 24h (L / S)
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={r.symbol} className="border-t border-rule">
                <td className="py-2.5">
                  <Link href={`/flow?s=${r.symbol}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="figures text-right">
                  {r.price === null ? "—" : formatPrice(r.price)}
                  {r.change24hPct !== null && (
                    <span
                      className={cn(
                        "ml-1.5 text-xs",
                        r.change24hPct >= 0 ? "text-profit" : "text-loss",
                      )}
                    >
                      {r.change24hPct >= 0 ? "+" : "−"}
                      {Math.abs(r.change24hPct).toFixed(2)}%
                    </span>
                  )}
                </td>
                {BIAS_TIMEFRAMES.map((tf) => (
                  <td key={tf} className="pl-3">
                    <BiasChip bias={r.bias.find((b) => b.timeframe === tf)} />
                  </td>
                ))}
                <td
                  className={cn(
                    "figures text-right",
                    (r.whaleNet24hUsd ?? 0) >= 0 ? "text-profit" : "text-loss",
                  )}
                >
                  {r.whaleNet24hUsd === null ? "—" : signedUsd(r.whaleNet24hUsd)}
                </td>
                <td className="figures text-right">
                  {r.liquidations24h
                    ? `${usdCompact(r.liquidations24h.longUsd)} / ${usdCompact(r.liquidations24h.shortUsd)}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-faint">
        Bias is the measured trend on closed candles (not a forecast).{" "}
        {data.allowed.length === 1 && (
          <>
            Ethereum, Solana, gold and silver are on{" "}
            <Link href="/billing" className="text-coach underline-offset-4 hover:underline">
              Pro
            </Link>
            .
          </>
        )}
      </p>
    </section>
  );
}
