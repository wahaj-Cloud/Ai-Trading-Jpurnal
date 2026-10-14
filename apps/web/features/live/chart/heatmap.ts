import type { LiquidationMapDto } from "@atc/shared";
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

/** Dark violet → blue → teal → green → yellow, the usual liquidation-heatmap palette. */
const STOPS: Array<[number, [number, number, number]]> = [
  [0, [68, 1, 84]],
  [0.25, [59, 82, 139]],
  [0.5, [33, 145, 140]],
  [0.75, [94, 201, 98]],
  [1, [253, 231, 37]],
];

export function heatColor(q: number): [number, number, number, number] {
  if (q <= 0) return [0, 0, 0, 0];
  const x = q / 255;
  let i = 0;
  while (i < STOPS.length - 2 && x > (STOPS[i + 1] as (typeof STOPS)[number])[0]) i++;
  const [x0, c0] = STOPS[i] as (typeof STOPS)[number];
  const [x1, c1] = STOPS[i + 1] as (typeof STOPS)[number];
  const f = (x - x0) / (x1 - x0 || 1);
  const mix = (k: 0 | 1 | 2) => Math.round(c0[k] + (c1[k] - c0[k]) * f);
  // Faint levels stay nearly see-through so candles remain readable; strong clusters glow.
  if (x < 0.06) return [0, 0, 0, 0];
  return [mix(0), mix(1), mix(2), Math.round(255 * Math.min(0.85, 0.04 + 0.85 * x ** 1.6))];
}

/** The map as a small image: one pixel per (time column, price bin), top row = highest price. */
export function heatmapImage(map: LiquidationMapDto): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const bytes = Uint8Array.from(atob(map.cells), (ch) => ch.charCodeAt(0));
  if (bytes.length !== map.count * map.bins) return null;
  const canvas = document.createElement("canvas");
  canvas.width = map.count;
  canvas.height = map.bins;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(map.count, map.bins);
  for (let t = 0; t < map.count; t++) {
    for (let b = 0; b < map.bins; b++) {
      const [r, g, bl, a] = heatColor(bytes[t * map.bins + b] as number);
      const o = ((map.bins - 1 - b) * map.count + t) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = bl;
      img.data[o + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Paints the estimated liquidation map behind the candles. The image is built once per map; each
 * frame draws it row by row (one strip per price band) so it lines up on linear and log scales.
 */
export class HeatmapPrimitive implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private map: LiquidationMapDto | null = null;
  private image: HTMLCanvasElement | null = null;
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

  set(map: LiquidationMapDto | null): void {
    this.map = map;
    this.image = map ? heatmapImage(map) : null;
    this.requestUpdate?.();
  }

  private draw(target: DrawTarget): void {
    const map = this.map;
    const image = this.image;
    if (!map || !image || !this.series) return;
    const left = this.toXY({ t: map.start / 1000, p: map.priceMax });
    const right = this.toXY({ t: (map.start + map.count * map.bucketMs) / 1000, p: map.priceMax });
    if (!left || !right || right.x <= left.x) return;
    const series = this.series;
    // biome-ignore lint/correctness/useHookAtTopLevel: a canvas API (fancy-canvas), not a React hook
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      const band = (map.priceMax - map.priceMin) / map.bins;
      for (let b = 0; b < map.bins; b++) {
        const top = series.priceToCoordinate(map.priceMin + (b + 1) * band);
        const bottom = series.priceToCoordinate(map.priceMin + b * band);
        if (top === null || bottom === null) continue;
        const row = map.bins - 1 - b;
        ctx.drawImage(
          image,
          0,
          row,
          map.count,
          1,
          left.x,
          top,
          right.x - left.x,
          Math.max(1, bottom - top),
        );
      }
      ctx.restore();
    });
  }
}
