import type { OpenPositionsDto, PositionsPage } from "@atc/shared";
import { CandlestickChart } from "lucide-react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { getOpenPositions } from "@/features/analytics/load";
import { OpenPositionsTable } from "@/features/analytics/open-positions-table";
import { getExchangeAccounts } from "@/features/exchanges/load";
import { getPositions } from "@/features/trades/load";
import { TradesTable } from "@/features/trades/trades-table";
import { cn } from "@/lib/cn";
import { getMe } from "@/lib/me";

export const metadata = { title: "Trades" };

const VIEWS = [
  { label: "Closed trades", value: undefined },
  { label: "Open now", value: "open" },
] as const;

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; cursor?: string; symbol?: string; day?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "open" ? "open" : undefined;
  const symbol = params.symbol?.toUpperCase().match(/^[A-Z0-9_]{2,30}$/)?.[0];
  const query = new URLSearchParams({ limit: "50", status: "CLOSED" });
  if (params.cursor) query.set("cursor", params.cursor);
  if (symbol) query.set("symbol", symbol);
  // From a calendar day: that day's closed trades, newest first.
  const day = params.day?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  if (day) {
    query.set("day", day);
    query.set("sort", "closed");
  }

  const empty: PositionsPage = { items: [], nextCursor: null };
  const [page, open, me, { accounts }] = await Promise.all([
    view ? Promise.resolve(empty) : getPositions(query),
    view ? getOpenPositions() : Promise.resolve<OpenPositionsDto | null>(null),
    getMe(),
    getExchangeAccounts(),
  ]);
  const importing = accounts.some((a) => a.status === "ACTIVE" && a.sync.state !== "IDLE");
  const href = (next: Record<string, string | undefined>) => {
    const q = new URLSearchParams(
      Object.entries({
        symbol: view ? undefined : symbol,
        day: view ? undefined : day,
        ...next,
      }).filter((e): e is [string, string] => Boolean(e[1])),
    );
    const s = q.toString();
    return s ? `/trades?${s}` : "/trades";
  };

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trades</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Newest first. Times in {me.timezone}. Synced automatically every few minutes. Open a
            trade to journal it.
          </p>
        </div>
        <ButtonLink href="/trades/import" variant="secondary">
          Import CSV
        </ButtonLink>
      </header>

      <nav aria-label="Trade views" className="flex flex-wrap gap-1">
        {VIEWS.map((f) => (
          <Link
            key={f.label}
            href={href({ view: f.value })}
            aria-current={view === f.value ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              view === f.value
                ? "border-coach text-ink"
                : "border-rule text-ink-muted hover:text-ink",
            )}
          >
            {f.label}
          </Link>
        ))}
        {day && !view && (
          <Link
            href={symbol ? `/trades?symbol=${symbol}` : "/trades"}
            className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-coach/60 bg-coach/15 px-3 py-1 text-sm text-ink hover:bg-coach/25"
            aria-label={`Showing trades closed on ${dayLabel(day)} only. Show all days`}
          >
            {dayLabel(day)} <span aria-hidden="true">×</span>
          </Link>
        )}
        {symbol && !view && (
          <Link
            href={day ? `/trades?day=${day}` : "/trades"}
            className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-coach/60 bg-coach/15 px-3 py-1 text-sm text-ink hover:bg-coach/25"
            aria-label={`Showing ${symbol} only. Show all coins`}
          >
            {symbol} <span aria-hidden="true">×</span>
          </Link>
        )}
      </nav>

      {importing && (
        <p
          role="status"
          className="rounded-[var(--radius-control)] border border-rule bg-raised px-4 py-3 text-sm"
        >
          We are importing your trade history. New trades appear here as each exchange finishes.
        </p>
      )}

      {open ? (
        <section className="rounded-[var(--radius-surface)] surface p-5">
          <OpenPositionsTable data={open} />
        </section>
      ) : page.items.length === 0 ? (
        <section className="rounded-[var(--radius-surface)] surface p-8 text-center">
          <CandlestickChart className="mx-auto h-6 w-6 text-coach" aria-hidden="true" />
          <h2 className="mt-3 font-semibold">
            {params.cursor
              ? "No older trades"
              : day
                ? `No trades closed on ${dayLabel(day)}`
                : symbol
                  ? `No ${symbol} trades`
                  : "No trades yet"}
          </h2>
          <p className="mx-auto mt-2 max-w-[52ch] text-sm text-ink-muted">
            {accounts.length === 0
              ? "Connect an exchange and your last three months of futures trades appear here automatically."
              : "Trades from your connected exchanges appear here after each sync. Older trades can be imported from a CSV file."}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {accounts.length === 0 && (
              <ButtonLink href="/exchanges/connect">Connect exchanges</ButtonLink>
            )}
            <ButtonLink href="/trades/import" variant="secondary">
              Import CSV
            </ButtonLink>
          </div>
        </section>
      ) : (
        <TradesTable items={page.items} timezone={me.timezone} />
      )}

      {(page.nextCursor || params.cursor) && (
        <nav aria-label="Pages" className="flex flex-wrap justify-between gap-3">
          {params.cursor ? (
            <Link href={href({})} className="text-sm text-ink-muted hover:text-ink">
              Back to newest
            </Link>
          ) : (
            <span />
          )}
          {page.nextCursor && (
            <ButtonLink href={href({ cursor: page.nextCursor })} variant="secondary" size="sm">
              Older trades
            </ButtonLink>
          )}
        </nav>
      )}
    </div>
  );
}
