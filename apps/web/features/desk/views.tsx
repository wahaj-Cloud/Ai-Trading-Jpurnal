import {
  DESK_DRIVER_INFO,
  type DeskAlignmentDto,
  type DeskDriverDto,
  type DeskEventDto,
  type DeskLean,
  type MarketDeskDto,
} from "@atc/shared";
import { CalendarClock, Crosshair, Sparkles } from "lucide-react";
import Link from "next/link";
import { BiasChip } from "@/features/flow/views";
import { FreshnessBadge } from "@/features/live-flow/freshness";
import { Countdown } from "@/features/news/countdown";
import { CurrencyFlag } from "@/features/news/currency-flag";
import { cn } from "@/lib/cn";
import { LivePrice } from "./live-price";

export const LEAN_STYLE: Record<DeskLean, { label: string; arrow: string; cls: string }> = {
  up: { label: "Leans up", arrow: "▲", cls: "bg-profit/12 text-profit" },
  down: { label: "Leans down", arrow: "▼", cls: "bg-loss/12 text-loss" },
  neutral: { label: "Neutral", arrow: "◆", cls: "bg-hi/[0.08] text-ink-muted" },
};

const LEAN_TEXT: Record<DeskLean, string> = {
  up: "text-profit",
  down: "text-loss",
  neutral: "text-ink-faint",
};

export function LeanPill({ lean, className }: { lean: DeskLean; className?: string }) {
  const s = LEAN_STYLE[lean];
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        s.cls,
        className,
      )}
    >
      <span aria-hidden="true">{s.arrow}</span>
      {s.label}
    </span>
  );
}

export const ago = (iso: string | null) => {
  if (!iso) return "not yet";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

const card = "surface min-w-0 rounded-[var(--radius-surface)] p-5";

/** Price, change and the tally of drivers (a count, never a verdict). */
export function MarketCard({ desk }: { desk: MarketDeskDto }) {
  const total = desk.drivers.length || 1;
  return (
    <section aria-label={`${desk.name} overview`} className={cn(card, "grid content-start gap-4")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">{desk.name}</h2>
        <FreshnessBadge at={desk.computedAt} every="every 15 min" staleAfterMs={30 * 60_000} />
      </div>
      <LivePrice symbol={desk.symbol} price={desk.price} change24hPct={desk.change24hPct} />
      <div className="grid gap-2">
        <div className="flex h-2 overflow-hidden rounded-full bg-hi/[0.06]" aria-hidden="true">
          <span className="bg-profit/80" style={{ width: `${(desk.leans.up / total) * 100}%` }} />
          <span className="bg-hi/25" style={{ width: `${(desk.leans.neutral / total) * 100}%` }} />
          <span className="bg-loss/80" style={{ width: `${(desk.leans.down / total) * 100}%` }} />
        </div>
        <p className="text-sm">
          <span className="text-profit">{desk.leans.up} lean up</span> ·{" "}
          <span className="text-loss">{desk.leans.down} lean down</span> ·{" "}
          <span className="text-ink-muted">{desk.leans.neutral} neutral</span>
        </p>
        <p className="text-xs text-ink-faint">
          A count of the drivers below, not a forecast. Read the evidence before you decide.
        </p>
      </div>
      {desk.bias && desk.bias.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
          <span className="text-xs text-ink-faint">Trend bias</span>
          {desk.bias.map((b) => (
            <BiasChip key={b.timeframe} bias={b} showTf />
          ))}
        </div>
      )}
      <ul className="grid gap-1.5 border-t border-rule pt-3 text-sm">
        {desk.drivers.map((d) => (
          <li key={d.key} className="flex items-center justify-between gap-3">
            <span className="text-ink-muted">{DESK_DRIVER_INFO[d.key].label}</span>
            <span className={cn("text-xs font-medium", LEAN_TEXT[d.lean])}>
              <span aria-hidden="true">{LEAN_STYLE[d.lean].arrow}</span> {LEAN_STYLE[d.lean].label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NextEventCard({ event }: { event: DeskEventDto | null }) {
  return (
    <section aria-labelledby="desk-next" className={cn(card, "grid content-start gap-3")}>
      <h2 id="desk-next" className="flex items-center gap-2 font-semibold">
        <CalendarClock className="h-4 w-4 text-coach" aria-hidden="true" />
        Next high-impact release
      </h2>
      {event ? (
        <>
          <p className="flex items-center gap-2 text-sm">
            <CurrencyFlag currency={event.currency} />
            <span className="font-medium">{event.title}</span>
          </p>
          <Countdown
            to={event.startsAt}
            className="figures text-2xl font-semibold text-[#f5b84d]"
          />
          <p className="text-xs text-ink-muted">
            {new Date(event.startsAt).toUTCString().slice(0, 22)} UTC
            {event.forecast ? ` · forecast ${event.forecast}` : ""}
            {event.previous ? ` · previous ${event.previous}` : ""}
          </p>
          <p className="text-xs text-ink-faint">
            Spreads widen and price often whipsaws in the minutes around a release.{" "}
            <Link href="/news" className="text-coach underline-offset-4 hover:underline">
              Calendar
            </Link>
          </p>
        </>
      ) : (
        <p className="text-sm text-ink-muted">No high-impact US release scheduled soon.</p>
      )}
    </section>
  );
}

export function AlignmentCard({ rows }: { rows: DeskAlignmentDto[] }) {
  return (
    <section aria-labelledby="desk-mine" className={cn(card, "grid content-start gap-3")}>
      <h2 id="desk-mine" className="flex items-center gap-2 font-semibold">
        <Crosshair className="h-4 w-4 text-coach" aria-hidden="true" />
        Your open trades vs context
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No open positions on these markets. When you hold one, it is compared with its market's
          drivers here.
        </p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((a) => (
            <li
              key={`${a.positionSymbol}${a.direction}`}
              className={cn(
                "rounded-[var(--radius-control)] border p-3 text-sm",
                a.against > a.with ? "border-loss/40" : "border-rule",
              )}
            >
              <p className="mb-1 flex items-center justify-between gap-2 text-xs text-ink-faint">
                <span>
                  {a.positionSymbol} ·{" "}
                  <span className={a.direction === "LONG" ? "text-profit" : "text-loss"}>
                    {a.direction === "LONG" ? "Long" : "Short"}
                  </span>
                </span>
                <span>
                  {a.with} with · {a.against} against · {a.neutral} neutral
                </span>
              </p>
              <p>{a.note}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SummaryCard({ desk }: { desk: MarketDeskDto }) {
  if (!desk.summary) return null;
  return (
    <section
      aria-labelledby="desk-summary"
      className={cn(card, "grid gap-2 border border-coach/25")}
    >
      <h2 id="desk-summary" className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4 text-coach" aria-hidden="true" />
        Desk summary <span className="font-normal text-ink-faint">· AI, {ago(desk.summaryAt)}</span>
      </h2>
      <p className="text-[15px] leading-relaxed">{desk.summary}</p>
    </section>
  );
}

export function DriverCard({ driver }: { driver: DeskDriverDto }) {
  const info = DESK_DRIVER_INFO[driver.key];
  return (
    <article className={cn(card, "grid content-start gap-3")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{info.label}</h3>
        <LeanPill lean={driver.lean} />
      </div>
      <p className="text-sm">{driver.headline}</p>
      <ul className="grid gap-1 text-sm text-ink-muted">
        {driver.evidence.map((e) => (
          <li key={e} className="flex gap-2">
            <span aria-hidden="true" className="text-ink-faint">
              •
            </span>
            <span className="figures">{e}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-faint">{info.about}</p>
    </article>
  );
}

export function RecentReleases({ events }: { events: DeskEventDto[] }) {
  if (events.length === 0) return null;
  return (
    <section aria-labelledby="desk-recent" className={cn(card, "grid gap-3")}>
      <h2 id="desk-recent" className="font-semibold">
        High-impact releases, last 24 hours
      </h2>
      <ul className="grid gap-2 text-sm">
        {events.map((e) => (
          <li
            key={`${e.title}${e.startsAt}`}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
          >
            <span className="flex items-center gap-2">
              <CurrencyFlag currency={e.currency} />
              {e.title}
            </span>
            <span className="figures text-ink-muted">
              Actual <span className="text-ink">{e.actual ?? "—"}</span> · forecast{" "}
              {e.forecast ?? "—"} · previous {e.previous ?? "—"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
