import { EXCHANGE_CATALOG, type PositionDto } from "@atc/shared";
import { NotebookPen, Star } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatDuration, formatNumber, formatPnl, pnlTone } from "./format";

const TONE = { profit: "text-profit", loss: "text-loss", flat: "text-ink-muted" } as const;

function Direction({ value }: { value: PositionDto["direction"] }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-xs font-medium",
        value === "LONG" ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss",
      )}
    >
      {value === "LONG" ? "Long" : "Short"}
    </span>
  );
}

function Notes({ p }: { p: PositionDto }) {
  const notes = [
    p.status === "OPEN" ? "Open" : null,
    p.incompleteHistory ? "Opened before synced history" : null,
    p.source === "CSV" ? "Imported" : null,
  ].filter(Boolean);
  return notes.length ? <span className="text-xs text-ink-faint">{notes.join(" · ")}</span> : null;
}

/** Journal state at a glance: the rating when given, a pen when notes exist, nothing otherwise. */
function Review({ p }: { p: PositionDto }) {
  if (!p.reviewed) return null;
  return p.rating ? (
    <span className="figures inline-flex items-center gap-0.5 text-xs text-coach">
      <Star className="h-3 w-3 fill-current" aria-hidden="true" />
      {p.rating}
      <span className="sr-only"> out of 5, reviewed</span>
    </span>
  ) : (
    <NotebookPen className="h-3.5 w-3.5 text-ink-muted" aria-label="Reviewed" />
  );
}

/**
 * Desktop: a dense table. Phones: one card per trade with the result first. Every trade links to
 * its detail page, where it is journaled.
 */
export function TradesTable({
  items,
  timezone,
  bare = false,
  compact = false,
}: {
  items: PositionDto[];
  timezone: string;
  /** Inside another panel: no outer frame. */
  bare?: boolean;
  /** Narrow panels: symbol, time and result only (size and prices are on the trade page). */
  compact?: boolean;
}) {
  const when = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });
  const date = (iso: string | null) => (iso ? when.format(new Date(iso)) : "—");

  return (
    <>
      <div
        className={cn(
          "hidden overflow-x-auto md:block",
          !bare && "rounded-[var(--radius-surface)] surface",
        )}
      >
        <table className="w-full text-sm">
          <caption className="sr-only">Trades, newest first</caption>
          <thead className="text-left text-xs text-ink-muted">
            <tr className="border-b border-rule">
              <th scope="col" className="px-4 py-3 font-medium">
                Symbol
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Opened
              </th>
              {!compact && (
                <th scope="col" className="px-4 py-3 font-medium">
                  Held
                </th>
              )}
              {!compact && (
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Size
                </th>
              )}
              {!compact && (
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Entry
                </th>
              )}
              {!compact && (
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Exit
                </th>
              )}
              {!compact && (
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Fees
                </th>
              )}
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Net P&amp;L
              </th>
            </tr>
          </thead>
          <tbody className="figures">
            {items.map((p) => (
              <tr
                key={p.id}
                className="relative border-b border-rule last:border-0 hover:bg-raised/40"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/trades/${p.id}`}
                      className="font-medium after:absolute after:inset-0 hover:underline"
                    >
                      {p.symbol}
                    </Link>
                    <Direction value={p.direction} />
                    <Review p={p} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-muted">
                    <span>{p.accountLabel ?? EXCHANGE_CATALOG[p.exchange].name}</span>
                    {p.leverage && <span>{formatNumber(p.leverage)}x</span>}
                    <Notes p={p} />
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{date(p.openedAt)}</td>
                {!compact && (
                  <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                    {formatDuration(p.holdingSeconds)}
                  </td>
                )}
                {!compact && (
                  <>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {formatNumber(p.quantity)}{" "}
                      <span className="text-ink-faint">{p.sizeAsset}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {formatNumber(p.entryPrice)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {formatNumber(p.exitPrice)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-ink-muted">
                      {formatNumber(p.fees)}
                    </td>
                  </>
                )}
                <td
                  className={cn(
                    "whitespace-nowrap px-4 py-3 text-right font-medium",
                    TONE[pnlTone(p.netPnl)],
                  )}
                >
                  {formatPnl(p.netPnl, p.settleAsset)}{" "}
                  <span className="text-xs text-ink-faint">{p.settleAsset}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-3 md:hidden">
        {items.map((p) => (
          <li key={p.id} className="relative rounded-[var(--radius-surface)] surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/trades/${p.id}`}
                    className="font-medium after:absolute after:inset-0"
                  >
                    {p.symbol}
                  </Link>
                  <Direction value={p.direction} />
                  <Review p={p} />
                </div>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {p.accountLabel ?? EXCHANGE_CATALOG[p.exchange].name} · {date(p.openedAt)}
                </p>
              </div>
              <p className={cn("figures text-right font-medium", TONE[pnlTone(p.netPnl)])}>
                {formatPnl(p.netPnl, p.settleAsset)}
                <span className="block text-xs text-ink-faint">{p.settleAsset}</span>
              </p>
            </div>
            <dl className="figures mt-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-ink-faint">Entry</dt>
                <dd>{formatNumber(p.entryPrice)}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">Exit</dt>
                <dd>{formatNumber(p.exitPrice)}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">Held</dt>
                <dd>{formatDuration(p.holdingSeconds)}</dd>
              </div>
            </dl>
            <div className="mt-2">
              <Notes p={p} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
