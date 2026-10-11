import type { ExchangeId } from "@atc/shared";
import { cn } from "@/lib/cn";

/** Distinct two-letter codes: first letters alone would make Binance and BingX identical. */
const MONOGRAMS: Record<ExchangeId, string> = {
  BINANCE: "BN",
  MEXC: "MX",
  KUCOIN: "KC",
  BINGX: "BX",
  EXNESS: "EX",
};

/**
 * Neutral monogram, not the exchange's logo: we must not reproduce third-party brand marks.
 * The exchange name always appears as text next to it.
 */
export function ExchangeMark({
  exchange,
  className,
}: {
  exchange: ExchangeId;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-rule bg-raised font-mono text-sm font-medium text-ink",
        className,
      )}
    >
      {MONOGRAMS[exchange]}
    </span>
  );
}
