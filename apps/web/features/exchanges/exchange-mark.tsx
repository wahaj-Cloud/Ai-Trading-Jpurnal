import type { ExchangeId } from "@atc/shared";
import { ExchangeBinance, ExchangeBybit, ExchangeKucoin } from "@web3icons/react";
import { cn } from "@/lib/cn";

/** Official marks from the MIT-licensed web3icons set, where the set has the venue. */
const MARKS: Partial<Record<ExchangeId, typeof ExchangeBinance>> = {
  BINANCE: ExchangeBinance,
  BYBIT: ExchangeBybit,
  KUCOIN: ExchangeKucoin,
};

/** Venues without a mark in the set get a lettered badge tinted with the venue's colour. */
const MONOGRAMS: Record<ExchangeId, { text: string; color: string }> = {
  BINANCE: { text: "B", color: "#f0b90b" },
  BYBIT: { text: "By", color: "#f7a600" },
  // OKX's mark is black, which disappears on our dark tiles.
  OKX: { text: "OKX", color: "#e5e7eb" },
  KUCOIN: { text: "K", color: "#24ae8f" },
  MEXC: { text: "M", color: "#3b82f6" },
  BINGX: { text: "BX", color: "#4a6bff" },
  EXNESS: { text: "Ex", color: "#ffd400" },
};

const SIZES = {
  xs: "h-5 w-5 rounded-[5px] text-[8px]",
  sm: "h-7 w-7 rounded-lg text-[10px]",
  md: "h-10 w-10 rounded-[var(--radius-control)] text-sm",
  lg: "h-12 w-12 rounded-xl text-base",
} as const;
const MARK_PX = { xs: 13, sm: 18, md: 26, lg: 32 } as const;

/** The exchange's icon on a small raised tile: xs for table rows, md for lists, lg for headers. */
export function ExchangeMark({
  exchange,
  size = "md",
  className,
}: {
  exchange: ExchangeId;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const Mark = MARKS[exchange];
  const mono = MONOGRAMS[exchange];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center border border-hi/12 bg-[#0b0f24] font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_4px_10px_-4px_rgba(0,0,0,0.7)]",
        SIZES[size],
        className,
      )}
      style={
        Mark
          ? undefined
          : {
              color: mono.color,
              background: `linear-gradient(160deg, color-mix(in srgb, ${mono.color} 30%, #0b0f24), #0b0f24 75%)`,
            }
      }
    >
      {Mark ? <Mark variant="branded" size={MARK_PX[size]} /> : mono.text}
    </span>
  );
}
