import {
  ORDERFLOW_WINDOW_LABEL,
  ORDERFLOW_WINDOWS,
  type ScalpCoinDto,
  STRENGTH_LABEL,
} from "@atc/shared";
import { Zap } from "lucide-react";
import Link from "next/link";
import { formatPrice } from "@/features/live/market";
import { coinName, pct } from "@/features/orderflow/format";
import { STRENGTH_STYLE } from "@/features/orderflow/strength";
import { cn } from "@/lib/cn";
import { Alignment } from "./views";

/** Dashboard: one or two coins' strength from 5m to 1D. */
export function ScalpWidget({ coins }: { coins: ScalpCoinDto[] }) {
  return (
    <section
      aria-labelledby="scalp-widget-heading"
      className="grid min-w-0 content-start gap-4 rounded-[var(--radius-surface)] surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="scalp-widget-heading" className="flex items-center gap-2 font-semibold">
          <Zap className="h-4 w-4 text-coach" aria-hidden="true" />
          Scalping strength
        </h2>
        <Link
          href="/scalp"
          className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Every coin
        </Link>
      </div>
      {coins.map((c) => (
        <div key={c.symbol} className="grid gap-2">
          <p className="flex flex-wrap items-baseline justify-between gap-2">
            <Link href={`/scalp?s=${c.symbol}`} className="font-semibold hover:underline">
              {coinName(c.symbol)}{" "}
              <span className="figures font-normal text-ink-muted">{formatPrice(c.price)}</span>
            </Link>
            {c.vwapDistPct !== null && (
              <span className="figures text-xs text-ink-muted">{pct(c.vwapDistPct)} vs VWAP</span>
            )}
          </p>
          <ul className="grid grid-cols-6 gap-1">
            {ORDERFLOW_WINDOWS.map((w) => {
              const f = c.frames[w];
              return (
                <li
                  key={w}
                  title={
                    f ? `${ORDERFLOW_WINDOW_LABEL[w]}: ${STRENGTH_LABEL[f.strength]}` : undefined
                  }
                  className={cn(
                    "grid place-items-center rounded-md py-1 text-[11px] font-semibold",
                    f ? STRENGTH_STYLE[f.strength].cell : "bg-hi/[0.04] text-ink-faint",
                  )}
                >
                  <span className="text-ink-muted">{ORDERFLOW_WINDOW_LABEL[w]}</span>
                  <span aria-hidden="true">{f ? STRENGTH_STYLE[f.strength].mark : "—"}</span>
                  {f && <span className="sr-only">{STRENGTH_LABEL[f.strength]}</span>}
                </li>
              );
            })}
          </ul>
          <Alignment coin={c} />
        </div>
      ))}
    </section>
  );
}
