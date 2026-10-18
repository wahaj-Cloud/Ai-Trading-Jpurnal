import {
  CHECK_GROUP_INFO,
  CHECK_GROUPS,
  CHECK_MIN_GROUP,
  type CheckFactorDto,
  type CheckLean,
  type CheckRecordDto,
  type CheckRecordGroupDto,
  fmtPrice,
  type TradeCheckDto,
} from "@atc/shared";
import { AlertTriangle, CalendarClock, History, ListChecks } from "lucide-react";
import Link from "next/link";
import { ago } from "@/features/desk/views";
import { BiasChip } from "@/features/flow/views";
import { Countdown } from "@/features/news/countdown";
import { cn } from "@/lib/cn";

const card = "surface min-w-0 rounded-[var(--radius-surface)] p-5";

export const LEAN_UI: Record<CheckLean, { label: string; arrow: string; cls: string }> = {
  long: { label: "Supports longs", arrow: "▲", cls: "bg-profit/12 text-profit" },
  short: { label: "Supports shorts", arrow: "▼", cls: "bg-loss/12 text-loss" },
  neutral: { label: "Neutral", arrow: "◆", cls: "bg-hi/[0.08] text-ink-muted" },
  info: { label: "Context", arrow: "i", cls: "bg-coach/10 text-coach" },
};

export function LeanTag({ lean }: { lean: CheckLean }) {
  const s = LEAN_UI[lean];
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        s.cls,
      )}
    >
      <span aria-hidden="true">{s.arrow}</span>
      {s.label}
    </span>
  );
}

/** The count of readings each way, the trend chips and the plain description. Never a verdict. */
export function TallyCard({ check, price }: { check: TradeCheckDto; price: React.ReactNode }) {
  const { long, short, neutral } = check.tally;
  const total = long + short + neutral || 1;
  return (
    <section aria-label="Overview" className={cn(card, "grid content-start gap-4 lg:col-span-2")}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-semibold">{check.name}</h2>
        <span className="text-xs text-ink-faint">Readings updated {ago(check.computedAt)}</span>
      </div>
      {price}
      <div className="grid gap-2">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Count n={long} label="support longs" cls="text-profit" />
          <Count n={neutral} label="neutral" cls="text-ink-muted" />
          <Count n={short} label="support shorts" cls="text-loss" />
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-hi/[0.06]" aria-hidden="true">
          <span className="bg-profit/80" style={{ width: `${(long / total) * 100}%` }} />
          <span className="bg-hi/25" style={{ width: `${(neutral / total) * 100}%` }} />
          <span className="bg-loss/80" style={{ width: `${(short / total) * 100}%` }} />
        </div>
      </div>
      {check.biases.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-faint">Trend</span>
          {check.biases.map((b) => (
            <BiasChip key={b.timeframe} bias={b} showTf />
          ))}
        </div>
      )}
      <ul className="grid gap-1.5 border-t border-rule pt-3 text-sm">
        {check.reading.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p className="text-xs text-ink-faint">
        A count of the readings below, each judged by the rule shown next to it. Not a forecast:
        decide your entry, stop and size yourself.
      </p>
    </section>
  );
}

function Count({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <div className="rounded-[var(--radius-control)] bg-hi/[0.03] px-2 py-2">
      <p className={cn("figures text-3xl font-semibold", cls)}>{n}</p>
      <p className="text-xs text-ink-muted">{label}</p>
    </div>
  );
}

/** Where price sits in last week's range, with yesterday's range and the 200-day EMA. */
export function RangeCard({ check }: { check: TradeCheckDto }) {
  const lv = check.levels;
  const price = check.price;
  if (!lv || price === null || lv.prevWeekHigh === null || lv.prevWeekLow === null) return null;
  const marks = [lv.prevWeekLow, lv.prevWeekHigh, lv.prevDayLow, lv.prevDayHigh, price];
  if (lv.ema200d !== null) marks.push(lv.ema200d);
  const lo = Math.min(...marks);
  const hi = Math.max(...marks);
  const span = hi - lo || 1;
  const x = (v: number) => `${((v - lo) / span) * 100}%`;
  return (
    <section aria-labelledby="check-range" className={cn(card, "grid content-start gap-4")}>
      <h2 id="check-range" className="font-semibold">
        Where price is
      </h2>
      <div className="relative mx-2 h-16" aria-hidden="true">
        <div
          className="absolute top-6 h-3 rounded-full bg-hi/[0.08]"
          style={{
            left: x(lv.prevWeekLow),
            width: `calc(${x(lv.prevWeekHigh)} - ${x(lv.prevWeekLow)})`,
          }}
        />
        <div
          className="absolute top-6 h-3 rounded-full bg-coach/30"
          style={{
            left: x(lv.prevDayLow),
            width: `calc(${x(lv.prevDayHigh)} - ${x(lv.prevDayLow)})`,
          }}
        />
        {lv.ema200d !== null && (
          <div
            className="absolute top-3 h-9 w-px bg-[#f5b84d]"
            style={{ left: x(lv.ema200d) }}
            title="200-day EMA"
          />
        )}
        <div className="absolute top-0 -translate-x-1/2" style={{ left: x(price) }}>
          <div className="mx-auto h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-ink" />
          <div className="mx-auto h-8 w-0.5 bg-ink" />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Level label="Last week high" v={lv.prevWeekHigh} price={price} />
        <Level label="Last week low" v={lv.prevWeekLow} price={price} />
        <Level label="Yesterday high" v={lv.prevDayHigh} price={price} />
        <Level label="Yesterday low" v={lv.prevDayLow} price={price} />
        {lv.ema200d !== null && <Level label="200-day EMA" v={lv.ema200d} price={price} />}
        {lv.ema50d !== null && <Level label="50-day EMA" v={lv.ema50d} price={price} />}
      </dl>
      <p className="flex flex-wrap gap-x-4 text-xs text-ink-faint">
        <span>
          <span className="mr-1 inline-block h-2 w-3 rounded-sm bg-hi/20" />
          Last week
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-3 rounded-sm bg-coach/40" />
          Yesterday
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-px bg-[#f5b84d]" /> 200-day EMA
        </span>
      </p>
    </section>
  );
}

function Level({ label, v, price }: { label: string; v: number; price: number }) {
  const d = (v / price - 1) * 100;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="figures">
        {fmtPrice(v)}{" "}
        <span className="text-xs text-ink-faint">
          {d >= 0 ? "+" : "−"}
          {Math.abs(d).toFixed(1)}%
        </span>
      </dd>
    </div>
  );
}

export function FlagsCard({ check }: { check: TradeCheckDto }) {
  const ev = check.nextEvent;
  return (
    <section aria-labelledby="check-flags" className={cn(card, "grid content-start gap-3")}>
      <h2 id="check-flags" className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4 text-[#f5b84d]" aria-hidden="true" />
        Risk flags
      </h2>
      {check.flags.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing unusual right now.</p>
      ) : (
        <ul className="grid gap-2">
          {check.flags.map((f) => (
            <li
              key={f.key}
              className={cn(
                "rounded-[var(--radius-control)] border p-3 text-sm",
                f.level === "high" ? "border-loss/50 bg-loss/[0.06]" : "border-[#f5b84d]/40",
              )}
            >
              {f.text}
            </li>
          ))}
        </ul>
      )}
      {ev && (
        <div className="grid gap-1 border-t border-rule pt-3">
          <p className="flex items-center gap-2 text-xs text-ink-faint">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            Next high-impact release
          </p>
          <p className="text-sm font-medium">
            {ev.currency} {ev.title}
          </p>
          <Countdown to={ev.startsAt} className="figures text-xl font-semibold text-[#f5b84d]" />
          <Link href="/news" className="text-xs text-coach underline-offset-4 hover:underline">
            Calendar
          </Link>
        </div>
      )}
    </section>
  );
}

export function FactorGroups({ factors }: { factors: CheckFactorDto[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {CHECK_GROUPS.map((g) => {
        const rows = factors.filter((f) => f.group === g);
        if (rows.length === 0) return null;
        const info = CHECK_GROUP_INFO[g];
        const longs = rows.filter((r) => r.lean === "long").length;
        const shorts = rows.filter((r) => r.lean === "short").length;
        return (
          <section
            key={g}
            aria-labelledby={`grp-${g}`}
            className={cn(card, "grid content-start gap-3")}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`grp-${g}`} className="font-semibold">
                {info.label}
              </h2>
              <span className="text-xs text-ink-faint">
                <span className="text-profit">{longs} ▲</span> ·{" "}
                <span className="text-loss">{shorts} ▼</span>
              </span>
            </div>
            <p className="text-xs text-ink-faint">{info.about}</p>
            <ul className="grid divide-y divide-rule">
              {rows.map((f) => (
                <li key={f.key} className="grid gap-1 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{f.label}</span>
                    <LeanTag lean={f.lean} />
                  </div>
                  <p className="figures text-sm">{f.value}</p>
                  <p className="text-xs text-ink-muted">{f.why}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const money = (v: string | null) => {
  if (v === null) return "—";
  const n = Number(v);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
};

function GroupLine({ g, emphasis }: { g: CheckRecordGroupDto; emphasis?: boolean }) {
  return (
    <li
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm",
        emphasis && "font-medium",
      )}
    >
      <span>{g.label}</span>
      {g.trades === 0 ? (
        <span className="text-xs text-ink-faint">no trades</span>
      ) : (
        <span className="figures text-xs">
          {g.trades} trades · {g.winRate !== null ? `${Math.round(g.winRate * 100)}% won` : "—"} ·{" "}
          <span className={Number(g.netPnl) >= 0 ? "text-profit" : "text-loss"}>
            {money(g.netPnl)}
          </span>
          {!g.enough && <span className="text-ink-faint"> · small sample</span>}
        </span>
      )}
    </li>
  );
}

/** How the trader did in the same conditions, for a long and for a short taken now. */
export function RecordCard({ record, name }: { record: CheckRecordDto; name: string }) {
  const by = new Map(record.groups.map((g) => [g.key, g]));
  const side = (keys: string[], label: string, cls: string) => (
    <div className="grid content-start gap-2 rounded-[var(--radius-control)] border border-rule p-3">
      <p className={cn("text-sm font-semibold", cls)}>{label}</p>
      <ul className="grid gap-1.5">
        {keys.map((k) => {
          const g = by.get(k);
          return g ? <GroupLine key={k} g={g} emphasis /> : null;
        })}
      </ul>
    </div>
  );
  return (
    <section aria-labelledby="check-record" className={cn(card, "grid gap-4")}>
      <h2 id="check-record" className="flex items-center gap-2 font-semibold">
        <History className="h-4 w-4 text-coach" aria-hidden="true" />
        Your record in these conditions
      </h2>
      {record.total === 0 ? (
        <p className="text-sm text-ink-muted">
          No closed {name} trades in the last 12 months yet. Once your synced trades include this
          market, you will see how you did with and against the trend, near releases and with
          crowded funding.
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            Your {record.total} closed {name} trades of the last 12 months, matched with the trend,
            funding and release calendar at the moment you entered. Under {CHECK_MIN_GROUP} trades a
            group is a small sample.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {side(record.now.long, "A long taken now would be…", "text-profit")}
            {side(record.now.short, "A short taken now would be…", "text-loss")}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-coach">Every condition</summary>
            <ul className="mt-3 grid gap-1.5">
              {record.groups.map((g) => (
                <GroupLine key={g.key} g={g} />
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}

export function MissingNote({ missing }: { missing: string[] }) {
  if (missing.length === 0) return null;
  return (
    <p className="flex items-start gap-2 text-xs text-ink-faint">
      <ListChecks className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      Not shown right now: {missing.join("; ")}.
    </p>
  );
}
