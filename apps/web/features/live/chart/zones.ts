import type { Candle } from "@atc/ta/indicators";
import { fairValueGaps, orderBlocks, type Zone } from "@atc/ta/structure";
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
  kind: "FVG" | "OB" | "BRK";
  bullish: boolean;
  top: number;
  bottom: number;
  /** Seconds (chart time) of the candle where it formed. */
  from: number;
  /** Price has traded back into it since. */
  touched: boolean;
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
  private colors = { up: "#26b07e", down: "#e5484d" };
  private readonly views: readonly IPrimitivePaneView[];

  constructor(private readonly toXY: (pt: ChartPoint) => { x: number; y: number } | null) {
    const renderer: IPrimitivePaneRenderer = {
      draw: () => {},
      drawBackground: (t) => this.draw(t),
    };
    this.views = [{ renderer: () => renderer, zOrder: () => "bottom" }];
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

  private draw(target: DrawTarget): void {
    const series = this.series;
    if (!series || this.zones.length === 0) return;
    // biome-ignore lint/correctness/useHookAtTopLevel: a canvas API (fancy-canvas), not a React hook
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.save();
      ctx.font = "600 10px system-ui, sans-serif";
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
}
