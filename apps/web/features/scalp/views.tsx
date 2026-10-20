import {
  ACTIVITY_LABEL,
  type BookDto,
  ORDERFLOW_WINDOW_LABEL,
  ORDERFLOW_WINDOWS,
  type ScalpCoinDto,
  type ScalpEventDto,
  STRENGTH_LABEL,
  shortTermAlignment,
  UNUSUAL_VOLUME,
} from "@atc/shared";
import { formatPrice } from "@/features/live/market";
import { coinName, pct, usd } from "@/features/orderflow/format";
import { STRENGTH_STYLE, StrengthBadge } from "@/features/orderflow/strength";
import { cn } from "@/lib/cn";

const tone = (v: number | null | undefined) =>
  v === null || v === undefined || v === 0 ? "" : v > 0 ? "text-profit" : "text-loss";
export const relVol = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v.toFixed(1)}×`;

/** One coin across 5m … 1D: strength, buy pressure, price, open interest and relative volume. */
export function TimeframeStrip({ coin }: { coin: ScalpCoinDto }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {ORDERFLOW_WINDOWS.map((w) => {
        const f = coin.frames[w];
        return (
          <div
            key={w}
            className={cn(
              "grid min-w-0 content-start gap-1.5 rounded-[var(--radius-control)] border border-rule p-3",
              f && STRENGTH_STYLE[f.strength].cell.split(" ")[0],
            )}
          >
            <p className="flex items-center justify-between text-xs font-semibold text-ink-muted">
              {ORDERFLOW_WINDOW_LABEL[w]}
              {f?.relVolume !== null &&
                f?.relVolume !== undefined &&
                f.relVolume >= UNUSUAL_VOLUME && (
                  <span className="rounded-full bg-[#f59e0b]/20 px-1.5 text-[10px] text-[#f59e0b]">
                    Unusual volume
                  </span>
                )}
            </p>
            {f ? (
              <>
                <StrengthBadge strength={f.strength} className="justify-self-start" />
                <dl className="figures grid grid-cols-[auto_1fr] gap-x-2 text-xs">
                  <dt className="text-ink-faint">Pressure</dt>
                  <dd className={cn("text-right", tone(f.buyPressurePct))}>
                    {pct(f.buyPressurePct, 1)}
                  </dd>
                  <dt className="text-ink-faint">Price</dt>
                  <dd className={cn("text-right", tone(f.priceChangePct))}>
                    {pct(f.priceChangePct)}
                  </dd>
                  <dt className="text-ink-faint">OI</dt>
                  <dd className={cn("text-right", tone(f.oiChangePct))}>{pct(f.oiChangePct)}</dd>
                  <dt className="text-ink-faint">Volume</dt>
                  <dd
                    className={cn(
                      "text-right",
                      (f.relVolume ?? 0) >= UNUSUAL_VOLUME && "font-semibold text-[#f59e0b]",
                    )}
                  >
                    {relVol(f.relVolume)}
                  </dd>
                </dl>
              </>
            ) : (
              <p className="text-xs text-ink-faint">Updating</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** "3 of 4 short timeframes buying": how many of 5m–1H lean each way. */
export function Alignment({ coin }: { coin: ScalpCoinDto }) {
  const a = shortTermAlignment(coin.frames);
  if (a.of === 0) return null;
  const text =
    a.buying === a.of
      ? `All ${a.of} short timeframes show buying`
      : a.selling === a.of
        ? `All ${a.of} short timeframes show selling`
        : `Short timeframes: ${a.buying} buying, ${a.selling} selling, ${a.of - a.buying - a.selling} neutral`;
  return (
    <p
      className={cn(
        "text-sm font-medium",
        a.buying === a.of ? "text-profit" : a.selling === a.of ? "text-loss" : "text-ink-muted",
      )}
    >
      {text} (5m, 15m, 30m, 1H).
    </p>
  );
}

/** Bids against asks within each distance of the mid price, as two bars meeting in the middle. */
export function BookPressure({ book }: { book: BookDto }) {
  const max = Math.max(1, ...book.bands.flatMap((b) => [b.bidUsd, b.askUsd]));
  return (
    <div className="grid gap-3">
      <p className="figures flex flex-wrap justify-between gap-2 text-xs text-ink-muted">
        <span>Mid {formatPrice(book.mid)}</span>
        <span>Spread {book.spreadBps.toFixed(2)} bps</span>
      </p>
      <ul className="grid gap-2">
        {book.bands.map((b) => (
          <li key={b.pct} className="grid grid-cols-[3.5rem_1fr_1fr_3.5rem] items-center gap-2">
            <span className="figures text-xs text-ink-faint">±{b.pct}%</span>
            <span className="flex justify-end" title={`Bids ${usd(b.bidUsd).replace("+", "")}`}>
              <span
                className="h-3 rounded-l-sm bg-profit/70"
                style={{ width: `${(b.bidUsd / max) * 100}%` }}
              />
            </span>
            <span className="flex" title={`Asks ${usd(b.askUsd).replace("+", "")}`}>
              <span
                className="h-3 rounded-r-sm bg-loss/70"
                style={{ width: `${(b.askUsd / max) * 100}%` }}
              />
            </span>
            <span className={cn("figures text-right text-xs font-semibold", tone(b.imbalancePct))}>
              {pct(b.imbalancePct, 0)}
            </span>
          </li>
        ))}
      </ul>
      <p className="flex justify-between text-xs text-ink-faint">
        <span className="text-profit">Bids (buy orders)</span>
        <span className="text-loss">Asks (sell orders)</span>
      </p>
      {book.bands.length < 5 && (
        <p className="text-xs text-ink-faint">
          Deep books: Binance's 1,000 levels reach ±{book.bands.at(-1)?.pct ?? 0}% on this coin.
        </p>
      )}
      {book.walls.length > 0 ? (
        <ul className="grid gap-1 text-xs">
          {book.walls.map((w) => (
            <li
              key={`${w.side}${w.price}`}
              className="figures flex flex-wrap justify-between gap-x-2"
            >
              <span className={w.side === "bid" ? "text-profit" : "text-loss"}>
                {w.side === "bid" ? "Bid wall" : "Ask wall"} at {formatPrice(w.price)}
              </span>
              <span className="text-ink-muted">
                {usd(w.usd).replace("+", "")} · {w.multiple.toFixed(0)}× usual ·{" "}
                {w.distPct.toFixed(2)}% away
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-faint">No unusually large orders near price.</p>
      )}
    </div>
  );
}

export const SCALP_FILTERS = [
  { id: "all", label: "All" },
  { id: "buying", label: "Buying on 5m + 15m" },
  { id: "selling", label: "Selling on 5m + 15m" },
  { id: "unusual", label: "Unusual volume" },
  { id: "active", label: "Very active" },
  { id: "mine", label: "Yours" },
] as const;
export type ScalpFilter = (typeof SCALP_FILTERS)[number]["id"];

const leans = (c: ScalpCoinDto, side: "buy" | "sell") =>
  (["5m", "15m"] as const).every((w) => {
    const s = c.frames[w]?.strength;
    return side === "buy"
      ? s === "buying" || s === "strong_buying"
      : s === "selling" || s === "strong_selling";
  });
export function filterCoins(coins: ScalpCoinDto[], f: ScalpFilter, mine: Set<string>) {
  return coins.filter((c) =>
    f === "buying"
      ? leans(c, "buy")
      : f === "selling"
        ? leans(c, "sell")
        : f === "unusual"
          ? (["5m", "15m"] as const).some((w) => (c.frames[w]?.relVolume ?? 0) >= UNUSUAL_VOLUME)
          : f === "active"
            ? c.volatility?.activity === "very_active"
            : f === "mine"
              ? mine.has(c.symbol)
              : true,
  );
}

/** Every coin against every timeframe: one coloured cell per strength. */
export function StrengthGrid({
  coins,
  href,
  selected,
  mine,
}: {
  coins: ScalpCoinDto[];
  href: (symbol: string) => string;
  selected: string;
  mine: Set<string>;
}) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[54rem] text-sm">
        <thead>
          <tr className="text-xs text-ink-faint">
            <th scope="col" className="pb-2 text-left font-medium">
              Coin
            </th>
            {ORDERFLOW_WINDOWS.map((w) => (
              <th key={w} scope="col" className="pb-2 text-center font-medium">
                {ORDERFLOW_WINDOW_LABEL[w]}
              </th>
            ))}
            <th scope="col" className="pb-2 text-right font-medium">
              Vol 5m
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Activity
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              vs VWAP
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Book ±0.25%
            </th>
          </tr>
        </thead>
        <tbody>
          {coins.map((c) => {
            const band = c.book?.bands.find((b) => b.pct === 0.25);
            const rv = c.frames["5m"]?.relVolume ?? null;
            return (
              <tr
                key={c.symbol}
                className={cn("border-t border-rule", c.symbol === selected && "bg-coach/[0.1]")}
              >
                <td className="py-1 pr-2">
                  <a href={href(c.symbol)} className="font-medium hover:underline">
                    {coinName(c.symbol)}
                  </a>
                  {mine.has(c.symbol) && <span className="ml-1 text-xs text-coach">●</span>}
                </td>
                {ORDERFLOW_WINDOWS.map((w) => {
                  const f = c.frames[w];
                  return (
                    <td key={w} className="px-0.5 py-1">
                      {f ? (
                        <a
                          href={href(c.symbol)}
                          title={`${ORDERFLOW_WINDOW_LABEL[w]}: ${STRENGTH_LABEL[f.strength]}, buy pressure ${pct(f.buyPressurePct, 1)}`}
                          className={cn(
                            "figures flex h-7 items-center justify-center gap-1 rounded-md text-xs font-semibold",
                            STRENGTH_STYLE[f.strength].cell,
                          )}
                        >
                          <span aria-hidden="true">{STRENGTH_STYLE[f.strength].mark}</span>
                          <span className="hidden xl:inline">{pct(f.buyPressurePct, 0)}</span>
                          <span className="sr-only">{STRENGTH_LABEL[f.strength]}</span>
                        </a>
                      ) : (
                        <span className="flex h-7 items-center justify-center text-ink-faint">
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
                <td
                  className={cn(
                    "figures pl-2 text-right",
                    (rv ?? 0) >= UNUSUAL_VOLUME && "font-semibold text-[#f59e0b]",
                  )}
                >
                  {relVol(rv)}
                </td>
                <td
                  className={cn(
                    "pl-2 text-right text-xs whitespace-nowrap",
                    c.volatility?.activity === "very_active"
                      ? "font-semibold text-[#f59e0b]"
                      : "text-ink-muted",
                  )}
                >
                  {c.volatility?.activity ? ACTIVITY_LABEL[c.volatility.activity] : "—"}
                </td>
                <td className={cn("figures text-right", tone(c.vwapDistPct))}>
                  {pct(c.vwapDistPct)}
                </td>
                <td className={cn("figures text-right", tone(band?.imbalancePct))}>
                  {band ? pct(band.imbalancePct, 0) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Session, news risk, levels and volatility ───

const minutesUntil = (iso: string, now: number) => Math.round((Date.parse(iso) - now) / 60_000);

/**
 * High-impact US releases: red when one is due within 30 minutes or came out in the last 15,
 * because spreads widen and price can jump several ATRs in seconds; otherwise the next one.
 */
export function NewsRisk({ events, now }: { events: ScalpEventDto[]; now: number }) {
  const hot = events.filter((e) => {
    const m = minutesUntil(e.startsAt, now);
    return m <= 30 && m >= -15;
  });
  const next = events.find((e) => Date.parse(e.startsAt) > now);
  if (hot.length > 0) {
    return (
      <p
        role="status"
        className="rounded-[var(--radius-control)] border border-loss/50 bg-loss/10 px-4 py-2 text-sm"
      >
        <strong className="text-loss">News risk: </strong>
        {hot
          .map((e) => {
            const m = minutesUntil(e.startsAt, now);
            return `${e.title} (${e.currency}) ${m > 0 ? `in ${m} min` : m === 0 ? "now" : `${-m} min ago`}`;
          })
          .join(" · ")}
        . Around high-impact releases spreads widen and price can jump several 5-minute ranges in
        seconds, on crypto and even more on gold.
      </p>
    );
  }
  return (
    <p className="text-xs text-ink-faint">
      {next
        ? `Next high-impact US release: ${next.title}, in ${Math.floor(minutesUntil(next.startsAt, now) / 60)} h ${minutesUntil(next.startsAt, now) % 60} min.`
        : "No high-impact US release in the next 4 hours."}
    </p>
  );
}

const dist = (level: number | null, price: number) =>
  level === null || !(level > 0) ? null : (level / price - 1) * 100;

/** Day, Asia-session and 24-hour highs and lows, with how far each is from price. */
export function LevelsCard({ coin }: { coin: ScalpCoinDto }) {
  const l = coin.levels;
  if (!l)
    return <p className="text-sm text-ink-muted">Levels appear after the next 5-minute scan.</p>;
  // Highest first, with the current price slotted in where it sits.
  const rows = (
    [
      ["24h high", l.high24h],
      ["Today's high", l.dayHigh],
      [l.asiaOpen ? "Asia high (session open)" : "Asia high", l.asiaHigh],
      ["VWAP", coin.vwap],
      [l.asiaOpen ? "Asia low (session open)" : "Asia low", l.asiaLow],
      ["Today's low", l.dayLow],
      ["24h low", l.low24h],
      ["Price now", coin.price],
    ] as Array<[string, number | null]>
  )
    .filter((r): r is [string, number] => r[1] !== null && r[1] > 0)
    .sort((a, b) => b[1] - a[1]);
  const asiaNote =
    !l.asiaOpen && l.asiaHigh !== null && l.asiaLow !== null
      ? coin.price > l.asiaHigh
        ? "Price is above the Asia range."
        : coin.price < l.asiaLow
          ? "Price is below the Asia range."
          : "Price is inside the Asia range."
      : null;
  return (
    <div className="grid gap-2">
      <table className="figures w-full text-sm">
        <tbody>
          {rows.map(([k, v]) => {
            const now = k === "Price now";
            const d = now ? null : dist(v, coin.price);
            return (
              <tr
                key={k}
                className={cn(
                  "border-t border-rule first:border-0",
                  now && "bg-coach/[0.12] font-semibold text-ink",
                )}
              >
                <td className={cn("py-1 pl-1", !now && "text-ink-muted")}>{k}</td>
                <td className="text-right">{formatPrice(v)}</td>
                <td className={cn("w-20 pr-1 text-right text-xs", tone(d))}>
                  {d === null ? "" : pct(d)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {asiaNote && <p className="text-xs text-ink-muted">{asiaNote} (Asia: 00:00–07:00 UTC)</p>}
    </div>
  );
}

/** Typical candle ranges (ATR 14) and whether the market is quieter or busier than usual. */
export function VolatilityCard({ coin }: { coin: ScalpCoinDto }) {
  const v = coin.volatility;
  const asPct = (x: number | null) => (x === null ? "" : `${((x / coin.price) * 100).toFixed(2)}%`);
  return (
    <div className="grid gap-2 text-sm">
      <p>
        Right now:{" "}
        <strong
          className={cn(
            v.activity === "very_active"
              ? "text-[#f59e0b]"
              : v.activity === "quiet"
                ? "text-ink-muted"
                : "text-ink",
          )}
        >
          {v.activity ? ACTIVITY_LABEL[v.activity] : "—"}
        </strong>
        {v.rangeRatio !== null && (
          <span className="text-ink-faint">
            {" "}
            (last 30 min moving {v.rangeRatio.toFixed(1)}× the usual 5-minute range)
          </span>
        )}
      </p>
      <dl className="figures grid grid-cols-3 gap-2">
        {(
          [
            ["5m", v.atr5m],
            ["15m", v.atr15m],
            ["1H", v.atr1h],
          ] as const
        ).map(([k, x]) => (
          <div key={k} className="rounded-[var(--radius-control)] bg-hi/[0.04] p-2">
            <dt className="text-xs text-ink-faint">Typical {k} range</dt>
            <dd className="font-semibold">{x === null ? "—" : formatPrice(x)}</dd>
            <dd className="text-xs text-ink-muted">{asPct(x)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-ink-faint">
        Average true range of the last 14 candles. A stop closer than one 5-minute range sits inside
        normal noise.
      </p>
    </div>
  );
}

/** Notes that only apply to gold and silver. */
export function MetalNote({ symbol }: { symbol: string }) {
  if (symbol !== "XAUUSDT" && symbol !== "XAGUSDT") return null;
  const metal = symbol === "XAUUSDT" ? "gold" : "silver";
  return (
    <p className="rounded-[var(--radius-control)] border border-[#f5c451]/40 bg-[#f5c451]/10 px-4 py-2 text-xs text-ink-muted">
      Figures come from Binance's {metal} futures ({symbol}, traded 24/7). Your broker's{" "}
      {symbol === "XAUUSDT" ? "XAUUSD" : "XAGUSD"} (for example Exness) can be a little apart in
      price, but the flow, ranges and levels describe the same market.{" "}
      {metal === "gold" ? "Gold" : "Silver"} moves most in the London and New York sessions and on
      US data: CPI, the jobs report and the Fed.
    </p>
  );
}
