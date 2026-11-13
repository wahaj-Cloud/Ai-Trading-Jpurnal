import { type Candle, sessionVwap } from "@atc/ta/indicators";
import { orderBlocks } from "@atc/ta/structure";
import { nearestZones, type SupplyDemandZone, supplyDemandZones } from "@atc/ta/supply-demand";

/**
 * The facts on a coin's card in Order Flow, worked out in the browser from Binance's closed candles
 * (no load on our servers): today's VWAP and range, yesterday's range, the nearest order blocks
 * either side on 15m, and the nearest 1H/4H supply above and demand below. Distances are % of the
 * price. Records of where price reacted, not forecasts.
 */

export interface Box {
  label: string;
  bottom: number;
  top: number;
  /** % from the price to the box's near edge (+ above, − below, 0 inside). */
  distPct: number;
  fresh?: boolean;
}

export interface XrayFacts {
  vwap: number | null;
  vwapDistPct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  prevHigh: number | null;
  prevLow: number | null;
  obAbove: Box | null;
  obBelow: Box | null;
  supply: Box | null;
  demand: Box | null;
}

const DAY = 86_400_000;

export const boxDist = (price: number, bottom: number, top: number) =>
  price >= bottom && price <= top ? 0 : ((price < bottom ? bottom : top) / price - 1) * 100;

/**
 * `c15`: closed 15-minute candles (two days or more). `zones`: closed 1H and 4H candles. `price`:
 * the price now.
 */
export function xrayFacts(
  c15: readonly Candle[],
  zones: { "1h": readonly Candle[]; "4h": readonly Candle[] },
  price: number,
): XrayFacts {
  const last = c15.at(-1);
  const dayStart = last ? Math.floor(last.t / DAY) * DAY : 0;
  const today = c15.filter((c) => c.t >= dayStart);
  const prev = c15.filter((c) => c.t >= dayStart - DAY && c.t < dayStart);
  const vw = sessionVwap(c15 as Candle[]);
  const vwap = today.length ? (vw.at(-1) ?? null) : null;

  // Order blocks on 15m still in play (a close through a block removes it), nearest either side.
  const obs = orderBlocks(c15 as Candle[]).filter((z) => z.kind === "ORDER_BLOCK");
  const near = (above: boolean): Box | null => {
    const list = obs
      .filter(
        (z) => (above ? z.bottom > price : z.top < price) || (price >= z.bottom && price <= z.top),
      )
      .map((z) => ({
        label: `15m ${z.direction === "BULLISH" ? "bullish" : "bearish"} order block`,
        bottom: z.bottom,
        top: z.top,
        distPct: boxDist(price, z.bottom, z.top),
      }))
      .filter((b) => (above ? b.distPct >= 0 : b.distPct <= 0))
      .sort((a, b) => Math.abs(a.distPct) - Math.abs(b.distPct));
    return list[0] ?? null;
  };

  // Nearest supply above and demand below across 1H and 4H.
  const sd: Array<SupplyDemandZone & { tf: string }> = [];
  for (const tf of ["1h", "4h"] as const)
    for (const z of nearestZones(supplyDemandZones(zones[tf]), price, 3)) sd.push({ ...z, tf });
  const pick = (side: "supply" | "demand"): Box | null => {
    const z = sd
      .filter((x) => x.side === side)
      .map((x) => ({
        label: `${x.tf.toUpperCase()} ${side} zone`,
        bottom: x.bottom,
        top: x.top,
        distPct: boxDist(price, x.bottom, x.top),
        fresh: x.tests === 0,
      }))
      .sort((a, b) => Math.abs(a.distPct) - Math.abs(b.distPct))[0];
    return z ?? null;
  };

  return {
    vwap,
    vwapDistPct: vwap ? (price / vwap - 1) * 100 : null,
    dayHigh: today.length ? Math.max(...today.map((c) => c.h)) : null,
    dayLow: today.length ? Math.min(...today.map((c) => c.l)) : null,
    prevHigh: prev.length ? Math.max(...prev.map((c) => c.h)) : null,
    prevLow: prev.length ? Math.min(...prev.map((c) => c.l)) : null,
    obAbove: near(true),
    obBelow: near(false),
    supply: pick("supply"),
    demand: pick("demand"),
  };
}
