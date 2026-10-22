import {
  ACTIVITY_LABEL,
  type CockpitDto,
  fixedMinus,
  type Lean,
  MOOD_LABEL,
  ORDERFLOW_WINDOW_LABEL,
  ORDERFLOW_WINDOWS,
  READOUT_GROUP_LABEL,
  type ReadoutGroup,
  STRENGTH_LABEL,
  ZONE_TF_LABEL,
} from "@atc/shared";
import { formatPrice } from "@/features/live/market";
import { pct, usd } from "@/features/orderflow/format";
import { STRENGTH_STYLE } from "@/features/orderflow/strength";
import { cn } from "@/lib/cn";

const LEAN_STYLE: Record<Lean, { mark: string; label: string; cls: string }> = {
  up: { mark: "▲", label: "Up", cls: "bg-profit/15 text-profit" },
  down: { mark: "▼", label: "Down", cls: "bg-loss/15 text-loss" },
  neutral: { mark: "•", label: "Neutral", cls: "bg-hi/[0.07] text-ink-muted" },
};

export function LeanBadge({ lean }: { lean: Lean }) {
  const s = LEAN_STYLE[lean];
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-[4.5rem] items-center justify-center gap-1 rounded-full px-2 text-xs font-semibold",
        s.cls,
      )}
    >
      <span aria-hidden="true">{s.mark}</span>
      {s.label}
    </span>
  );
}

/** The tally as one bar: how many readings lean up, down or neither. */
export function Tally({ dto }: { dto: CockpitDto }) {
  const { up, down, neutral } = dto.tally;
  const total = up + down + neutral;
  if (total === 0) return null;
  const lead =
    up > down
      ? `${up} of ${total} readings lean up`
      : down > up
        ? `${down} of ${total} readings lean down`
        : `Readings split evenly (${up} up, ${down} down)`;
  return (
    <div className="grid gap-3">
      <p className="text-sm text-ink-muted">On {dto.tf}, now</p>
      <p
        className={cn(
          "text-2xl font-semibold tracking-tight",
          up > down ? "text-profit" : down > up ? "text-loss" : "text-ink",
        )}
      >
        {lead}
      </p>
      <div className="flex h-3 overflow-hidden rounded-full" aria-hidden="true">
        <span className="bg-profit" style={{ width: `${(up / total) * 100}%` }} />
        <span className="bg-hi/20" style={{ width: `${(neutral / total) * 100}%` }} />
        <span className="bg-loss" style={{ width: `${(down / total) * 100}%` }} />
      </div>
      <p className="figures flex justify-between text-sm">
        <span className="text-profit">▲ {up} up</span>
        <span className="text-ink-muted">• {neutral} neutral</span>
        <span className="text-loss">▼ {down} down</span>
      </p>
      <p className="text-xs text-ink-faint">
        A count of readings, each by its fixed rule. It is not a call: markets often move against
        most readings.
      </p>
    </div>
  );
}

export function Flags({ flags }: { flags: CockpitDto["flags"] }) {
  if (flags.length === 0)
    return (
      <p className="rounded-[var(--radius-control)] border border-rule px-4 py-2 text-sm text-ink-muted">
        No warnings right now: no release within 30 minutes, no fresh high-impact headline, normal
        spread and activity.
      </p>
    );
  return (
    <ul className="grid gap-2">
      {flags.map((f) => (
        <li
          key={f.key}
          className={cn(
            "rounded-[var(--radius-control)] border px-4 py-2 text-sm",
            f.level === "high"
              ? "border-loss/50 bg-loss/10"
              : "border-[#f59e0b]/50 bg-[#f59e0b]/10",
          )}
        >
          <strong className={f.level === "high" ? "text-loss" : "text-[#f59e0b]"}>
            {f.level === "high" ? "Warning: " : "Note: "}
          </strong>
          {f.text}
        </li>
      ))}
    </ul>
  );
}

/** Every counted reading, grouped, with its rule. */
export function ReadoutTable({ rows }: { rows: CockpitDto["rows"] }) {
  const groups = [...new Set(rows.map((r) => r.group))] as ReadoutGroup[];
  return (
    <div className="grid gap-4">
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-faint uppercase">
            {READOUT_GROUP_LABEL[g]}
          </p>
          <ul className="grid gap-1.5">
            {rows
              .filter((r) => r.group === g)
              .map((r) => (
                <li
                  key={r.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 rounded-[var(--radius-control)] bg-hi/[0.03] px-3 py-2 sm:grid-cols-[9rem_minmax(0,1fr)_auto]"
                >
                  <span className="text-sm font-medium">{r.label}</span>
                  <span className="figures order-3 col-span-2 text-sm text-ink-muted sm:order-none sm:col-span-1">
                    {r.value}
                    <span className="block text-xs text-ink-faint">{r.rule}</span>
                  </span>
                  <LeanBadge lean={r.lean} />
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Price ladder: nearest levels and estimated liquidation pools above and below price. */
export function Ladder({ dto }: { dto: CockpitDto }) {
  const coin = dto.coin;
  if (!coin) return null;
  const items: Array<{
    label: string;
    price: number;
    dist: number;
    kind: "level" | "liq" | "now" | "supply" | "demand";
    usd?: number;
    /** Zones: the far edge, whether price is inside, fresh or tested. */
    far?: number;
    inside?: boolean;
    note?: string;
  }> = [];
  const push = (
    l: { label: string; price: number; distPct: number; usd?: number } | null,
    kind: "level" | "liq",
  ) => {
    if (l) items.push({ label: l.label, price: l.price, dist: l.distPct, kind, usd: l.usd });
  };
  push(dto.levelAbove, "level");
  push(dto.levelBelow, "level");
  push(dto.liqAbove, "liq");
  push(dto.liqBelow, "liq");
  // Zones sit at their near edge (supply: bottom, demand: top).
  for (const z of dto.zones) {
    items.push({
      label: `${ZONE_TF_LABEL[z.tf]} ${z.side} zone`,
      note: z.tests === 0 ? "fresh" : `tested ${z.tests}×`,
      price: z.side === "supply" ? z.bottom : z.top,
      far: z.side === "supply" ? z.top : z.bottom,
      dist: z.distPct,
      kind: z.side,
      inside: z.distPct === 0,
    });
  }
  items.push({ label: "Price now", price: coin.price, dist: 0, kind: "now" });
  // Highest first; a zone the price is inside sits next to the price.
  const at = (x: (typeof items)[number]) => (x.inside ? coin.price : x.price);
  items.sort((a, b) => at(b) - at(a));
  const atr = coin.volatility.atr5m;
  return (
    <ul className="grid gap-1">
      {items.map((x) => (
        <li
          key={`${x.label}${x.price}`}
          className={cn(
            "figures flex items-center justify-between gap-2 rounded-[var(--radius-control)] px-3 py-1.5 text-sm",
            x.kind === "now" ? "bg-coach/15 font-semibold" : "bg-hi/[0.03]",
          )}
        >
          <span
            className={cn(
              x.kind === "liq" && "text-[#a78bfa]",
              x.kind === "supply" && "text-loss",
              x.kind === "demand" && "text-profit",
            )}
          >
            {x.label}
            {x.note && <span className="ml-1 text-xs text-ink-faint">· {x.note}</span>}
            {x.usd ? (
              <span className="ml-1 text-xs text-ink-faint">
                ({usd(x.usd).replace("+", "")} est.)
              </span>
            ) : null}
          </span>
          <span className="grid justify-items-end">
            <span>
              {x.far === undefined
                ? formatPrice(x.price)
                : `${formatPrice(Math.min(x.price, x.far))}–${formatPrice(Math.max(x.price, x.far))}`}
            </span>
            {x.inside ? (
              <span className="text-xs text-coach">price inside</span>
            ) : (
              x.kind !== "now" && (
                <span className={cn("text-xs", x.dist > 0 ? "text-profit" : "text-loss")}>
                  {pct(x.dist)}
                  {atr ? ` · ${(Math.abs(x.price - coin.price) / atr).toFixed(1)} ranges` : ""}
                </span>
              )
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One line per timeframe, 5m to 1D. */
export function StrengthStrip({ dto }: { dto: CockpitDto }) {
  const coin = dto.coin;
  if (!coin) return null;
  return (
    <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
      {ORDERFLOW_WINDOWS.map((w) => {
        const f = coin.frames[w];
        return (
          <li
            key={w}
            title={
              f
                ? `${STRENGTH_LABEL[f.strength]}, buy pressure ${pct(f.buyPressurePct, 1)}`
                : undefined
            }
            className={cn(
              "relative grid place-items-center rounded-md py-1.5 text-xs font-semibold",
              f ? STRENGTH_STYLE[f.strength].cell : "bg-hi/[0.04] text-ink-faint",
              w === dto.tf && "ring-2 ring-coach",
            )}
          >
            <span className="text-ink-muted">{ORDERFLOW_WINDOW_LABEL[w]}</span>
            <span aria-hidden="true">{f ? STRENGTH_STYLE[f.strength].mark : "—"}</span>
            <span className="figures text-[11px]">{f ? pct(f.buyPressurePct, 0) : ""}</span>
            {f && <span className="sr-only">{STRENGTH_LABEL[f.strength]}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Price, VWAP, typical range, activity and spread at a glance. */
export function KeyNumbers({ dto }: { dto: CockpitDto }) {
  const c = dto.coin;
  if (!c) return null;
  const v = c.volatility;
  const cells: Array<[string, string, string?]> = [
    ["Price", formatPrice(c.price)],
    [
      "vs VWAP",
      pct(c.vwapDistPct),
      c.vwapDistPct === null ? "" : c.vwapDistPct >= 0 ? "text-profit" : "text-loss",
    ],
    [
      "Typical 5m range",
      v.atr5m ? `${formatPrice(v.atr5m)} (${((v.atr5m / c.price) * 100).toFixed(2)}%)` : "—",
    ],
    ["Typical 15m range", v.atr15m ? formatPrice(v.atr15m) : "—"],
    [
      "Activity",
      v.activity ? ACTIVITY_LABEL[v.activity] : "—",
      v.activity === "very_active" ? "text-[#f59e0b]" : "",
    ],
    ["Spread", c.book ? `${c.book.spreadBps.toFixed(2)} bps` : "—"],
    ["Funding", c.funding === null ? "—" : `${(c.funding * 100).toFixed(4)}%`],
    ["Link to BTC (24h)", dto.btcCorr24h === null ? "—" : fixedMinus(dto.btcCorr24h, 2)],
    ...(["15m", "1h"] as const).map((tf): [string, string, string?] => {
      const r = dto.ratings?.[tf];
      return [
        `Market mood ${tf === "1h" ? "1H" : tf}`,
        r?.mood
          ? `${MOOD_LABEL[r.mood]}${r.adx !== null ? ` (ADX ${r.adx.toFixed(0)})` : ""}`
          : "—",
        r?.mood === "trending_up" ? "text-profit" : r?.mood === "trending_down" ? "text-loss" : "",
      ];
    }),
  ];
  return (
    <dl className="figures grid grid-cols-2 gap-2">
      {cells.map(([k, val, cls]) => (
        <div key={k} className="rounded-[var(--radius-control)] bg-hi/[0.04] p-2.5">
          <dt className="text-xs text-ink-faint">{k}</dt>
          <dd className={cn("text-sm font-semibold", cls)}>{val}</dd>
        </div>
      ))}
    </dl>
  );
}
