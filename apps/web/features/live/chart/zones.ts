import { formatPrice } from "@atc/shared";
import type { Candle } from "@atc/ta/indicators";
import { fairValueGaps, orderBlocks, type Zone } from "@atc/ta/structure";
import { nearestZones, supplyDemandZones } from "@atc/ta/supply-demand";
import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { ChartPoint } from "./geometry";

type DrawTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

/** At most this many of each kind, newest first, so the chart stays readable. */
const MAX_FVG = 8;
const MAX_OB = 6;
/** Gaps narrower than this share of price are noise and are not drawn. */
const MIN_GAP = 0.0005;
/** Candles searched (the most recent). */
const LOOKBACK = 500;

export interface ChartZone {
  /** SUP / DEM: supply and demand zones (drawn stronger, labelled at the right edge). */
  kind: "FVG" | "OB" | "BRK" | "SUP" | "DEM";
  bullish: boolean;
  top: number;
  bottom: number;
  /** Seconds (chart time) of the candle where it formed. */
  from: number;
  /** Price has traded back into it since. */
  touched: boolean;
  /** Right-edge label (supply and demand zones): "Supply · 1H · fresh". */
  label?: string;
}

/** Supply and demand zones are searched over this many closed candles of their timeframe. */
const SD_LOOKBACK = 1000;
/** Nearest zones kept on each side of the price. */
export const SD_PER_SIDE = 3;

/** "1H", "4H", "1D", "15m": how traders write timeframes. */
export const tfLabel = (tf: string) => (/[hdw]$/.test(tf) ? tf.toUpperCase() : tf);

/**
 * The nearest supply zones above the price and demand zones below it, found on the candles of the
 * timeframe they belong to (`tf`). Closed candles only.
 */
export function sdChartZones(candles: readonly Candle[], price: number, tf: string): ChartZone[] {
  const zones = nearestZones(supplyDemandZones(candles.slice(-SD_LOOKBACK)), price, SD_PER_SIDE);
  return zones.map((z) => ({
    kind: z.side === "supply" ? "SUP" : "DEM",
    bullish: z.side === "demand",
    top: z.top,
    bottom: z.bottom,
    from: Math.floor(z.t / 1000),
    touched: z.tests > 0,
    label: `${z.side === "supply" ? "Supply" : "Demand"} · ${tfLabel(tf)} · ${
      z.tests === 0 ? "fresh" : `tested ${z.tests}×`
    }`,
  }));
}

/**
 * Unfilled fair value gaps and live order blocks (plus breakers) from the same detection the
 * setup alerts use. A gap counts until price trades into it; a block until price closes through it.
 */
export function chartZones(
  candles: readonly Candle[],
  show: { fvg: boolean; ob: boolean },
): ChartZone[] {
  const c = candles.slice(-LOOKBACK);
  const out: ChartZone[] = [];
  if (show.fvg) {
    const gaps = fairValueGaps(c)
      .filter((z) => !z.touched && (z.top - z.bottom) / z.top >= MIN_GAP)
      .slice(-MAX_FVG);
    out.push(...gaps.map((z) => toChart(z, "FVG")));
  }
  if (show.ob) {
    const blocks = orderBlocks(c)
      .filter((z) => z.kind === "ORDER_BLOCK" || z.kind === "BREAKER")
      // Still in play. An order block is dropped by the detection itself once a close goes through
      // it. A breaker (a broken block that flipped sides) counts from the candle that broke it, and
      // is dropped once a later close goes back through its far side.
      .filter((z) => {
        if (z.kind === "ORDER_BLOCK") return true;
        if (z.brokenIndex === null || z.brokenIndex === undefined) return false;
        const after = c.slice(z.brokenIndex + 1);
        return z.direction === "BULLISH"
          ? !after.some((x) => x.c < z.bottom)
          : !after.some((x) => x.c > z.top);
      })
      .slice(-MAX_OB);
    out.push(...blocks.map((z) => toChart(z, z.kind === "BREAKER" ? "BRK" : "OB")));
  }
  return out;
}

function toChart(z: Zone, kind: ChartZone["kind"]): ChartZone {
  return {
    kind,
    bullish: z.direction === "BULLISH",
    top: z.top,
    bottom: z.bottom,
    from: Math.floor(z.t / 1000),
    touched: z.touched,
  };
}

/** Draws the zones as boxes from the candle they formed on to the right edge. */
export class ZonesPrimitive implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private zones: ChartZone[] = [];
  /** Label positions already used in the current frame. */
  private placed: number[] = [];
  private colors = { up: "#26b07e", down: "#e5484d" };
  private readonly views: readonly IPrimitivePaneView[];

  constructor(private readonly toXY: (pt: ChartPoint) => { x: number; y: number } | null) {
    // Boxes sit behind the candles; supply and demand labels sit above them.
    const boxes: IPrimitivePaneRenderer = { draw: (t) => this.draw(t, "boxes") };
    const labels: IPrimitivePaneRenderer = { draw: (t) => this.draw(t, "labels") };
    this.views = [
      { renderer: () => boxes, zOrder: () => "bottom" },
      { renderer: () => labels, zOrder: () => "top" },
    ];
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  set(zones: ChartZone[], colors: { up: string; down: string }): void {
    this.zones = zones;
    this.colors = colors;
    this.requestUpdate?.();
  }

  private draw(target: DrawTarget, layer: "boxes" | "labels"): void {
    const series = this.series;
    if (!series || this.zones.length === 0) return;
    // biome-ignore lint/correctness/useHookAtTopLevel: a canvas API (fancy-canvas), not a React hook
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.save();
      ctx.font = "600 10px system-ui, sans-serif";
      // Supply and demand zones out of view are listed at the top or bottom edge, nearest first.
      let above = 0;
      let below = 0;
      if (layer === "labels") this.placed = [];
      for (const z of this.zones) {
        const start = this.toXY({ t: z.from, p: z.top });
        const top = series.priceToCoordinate(z.top);
        const bottom = series.priceToCoordinate(z.bottom);
        if (!start || top === null || bottom === null) continue;
        const x = Math.max(0, start.x);
        const w = mediaSize.width - x;
        if (w <= 0) continue;
        const color = z.bullish ? this.colors.up : this.colors.down;
        const h = Math.max(1, bottom - top);
        if (z.kind === "SUP" || z.kind === "DEM") {
          const offTop = bottom < 0;
          const offBottom = top > mediaSize.height;
          if (offTop || offBottom) {
            if (layer !== "labels") continue;
            // Narrow charts (phones): shorter text, below the price legend, two per edge.
            const narrow = mediaSize.width < 520;
            const n = offTop ? above++ : below++;
            if (narrow && n >= 2) continue;
            const name = narrow ? (z.label ?? "").split(" · ").slice(0, 2).join(" ") : z.label;
            const text = `${offTop ? "↑" : "↓"} ${name ?? ""} ${formatPrice(z.bottom)}–${formatPrice(z.top)}`;
            ctx.font = `600 ${narrow ? 10 : 11}px system-ui, sans-serif`;
            const pw = ctx.measureText(text).width + 12;
            const first = offTop ? (narrow ? 48 : 4) : mediaSize.height - 22;
            const py = offTop ? first + n * 22 : first - n * 22;
            this.pill(ctx, text, Math.max(4, mediaSize.width - pw - 8), py, color);
            ctx.font = "600 10px system-ui, sans-serif";
            continue;
          }
          this.drawSupplyDemand(ctx, z, x, top, w, h, color, layer);
          continue;
        }
        if (layer === "labels") continue;
        ctx.globalAlpha = z.touched ? 0.07 : 0.14;
        ctx.fillStyle = color;
        ctx.fillRect(x, top, w, h);
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = color;
        ctx.setLineDash(z.kind === "FVG" ? [4, 3] : []);
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, top + 0.5, w - 1, h - 1);
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.9;
        ctx.fillText(
          z.kind === "FVG" ? "FVG" : z.kind === "BRK" ? "Breaker" : "OB",
          x + 4,
          top + 11 > bottom ? top - 3 : top + 11,
        );
      }
      ctx.restore();
    });
  }

  private pill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
    const w = ctx.measureText(text).width + 12;
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, 18, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, x + 6, y + 13);
  }

  /** A filled box with a solid edge and a label pill at the right edge, like a trader would draw. */
  private drawSupplyDemand(
    ctx: CanvasRenderingContext2D,
    z: ChartZone,
    x: number,
    top: number,
    w: number,
    h: number,
    color: string,
    layer: "boxes" | "labels",
  ): void {
    if (layer === "boxes") {
      ctx.globalAlpha = z.touched ? 0.12 : 0.2;
      ctx.fillStyle = color;
      ctx.fillRect(x, top, w, h);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash(z.touched ? [5, 3] : []);
      ctx.strokeRect(x + 0.5, top + 0.5, w - 1, h - 1);
      ctx.setLineDash([]);
      return;
    }
    const text = z.label ?? "";
    if (!text) return;
    ctx.font = "600 11px system-ui, sans-serif";
    const pw = ctx.measureText(text).width + 12;
    const ph = 18;
    // Right-aligned (it may start left of a box that formed near the right edge), and moved off
    // any label already drawn so close zones stay readable.
    const px = Math.max(4, x + w - pw - 8);
    let py = h >= ph + 4 ? top + (h - ph) / 2 : top - ph - 2;
    for (let guard = 0; guard < 6 && this.placed.some((y) => Math.abs(y - py) < ph + 2); guard++)
      py += ph + 2;
    this.placed.push(py);
    this.pill(ctx, text, px, py, color);
    ctx.font = "600 10px system-ui, sans-serif";
  }
}
