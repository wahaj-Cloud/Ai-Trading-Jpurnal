import {
  isLiveWindow,
  ORDERFLOW_DISCLAIMER,
  ORDERFLOW_WINDOW_LABEL,
  ORDERFLOW_WINDOWS,
  type OrderflowResponse,
  orderflowQuerySchema,
} from "@atc/shared";
import Link from "next/link";
import { AutoRefresh } from "@/features/labs/backtest-views";
import { type MatrixFilter, orderflowHref } from "@/features/orderflow/href";
import { OrderflowBoard } from "@/features/orderflow/live-board";
import { TABLE_SORTS, type TableSort } from "@/features/orderflow/views";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

export const metadata = { title: "Order Flow" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const MATRIX_FILTERS = ["all", "aligned", "conflict"] as const;

/**
 * Order Flow: who is pushing in the most traded futures (market buying vs selling), whether new
 * money is entering or leaving (open interest), how price responded, and what that means in plain
 * words. 5m to 1H are live (every second, open interest every 5 seconds) through the live stream;
 * 4H and 1D come from the 5-minute scan. The page itself reloads every few minutes for the parts
 * that are not live.
 */
export default async function OrderflowPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const q = orderflowQuerySchema.safeParse({ window: one(raw.w) });
  const window = q.success ? q.data.window : "1h";
  const sortParam = one(raw.sort);
  const sort: TableSort = TABLE_SORTS.some((s) => s.id === sortParam)
    ? (sortParam as TableSort)
    : "volume";
  const mxParam = one(raw.mx);
  const mx: MatrixFilter = (MATRIX_FILTERS as readonly string[]).includes(mxParam ?? "")
    ? (mxParam as MatrixFilter)
    : "all";
  const data = await apiFetch<OrderflowResponse>(`/v1/market/order-flow?window=${window}`);
  const selectedSymbol = one(raw.c)?.toUpperCase();

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-8">
      <AutoRefresh every={isLiveWindow(window) ? 5 * 60_000 : 60_000} />
      <header className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-coach uppercase">
              <span className="live-dot" aria-hidden="true" />
              Live · Binance futures
            </p>
            <h1 className="glow-text mt-1 text-3xl font-semibold tracking-tight">Order Flow</h1>
            <p className="mt-1 max-w-3xl text-sm text-ink-muted">
              Who is pushing in the {data.universe || 100} most traded futures: whether traders are
              buying or selling in a hurry (market orders), whether new money is coming in or
              leaving (open interest), how price reacted, and what that means in plain words.
            </p>
          </div>
        </div>
        <nav
          aria-label="Period"
          className="raised inline-flex w-fit max-w-full flex-wrap gap-1 rounded-full p-1"
        >
          {ORDERFLOW_WINDOWS.map((w) => (
            <Link
              key={w}
              href={orderflowHref({ window, sort, mx }, { w })}
              scroll={false}
              aria-current={w === window ? "page" : undefined}
              className={cn(
                "figures inline-flex h-8 min-w-12 items-center justify-center rounded-full px-3 text-sm",
                w === window
                  ? "bg-coach font-semibold text-coach-ink shadow-[0_0_18px_-2px_var(--color-glow)]"
                  : "text-ink-muted hover:bg-hi/[0.06] hover:text-ink",
              )}
            >
              {ORDERFLOW_WINDOW_LABEL[w]}
            </Link>
          ))}
        </nav>
      </header>

      <OrderflowBoard
        initial={data}
        window={window}
        sort={sort}
        mx={mx}
        selectedSymbol={selectedSymbol ?? null}
      />
      <p className="text-xs text-ink-faint">{ORDERFLOW_DISCLAIMER}</p>
    </div>
  );
}
