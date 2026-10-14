import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  Logical,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import { z } from "zod";
import {
  type ChartPoint,
  distToSegment,
  FIB_LEVELS,
  fibPrices,
  rayEnd,
  type TimeAxis,
} from "./geometry";

export const DRAWING_KINDS = ["trend", "ray", "hline", "vline", "rect", "fib"] as const;
export type DrawingKind = (typeof DRAWING_KINDS)[number];

export const DRAWING_LABELS: Record<DrawingKind, string> = {
  trend: "Trend line",
  ray: "Ray",
  hline: "Horizontal line",
  vline: "Vertical line",
  rect: "Rectangle",
  fib: "Fibonacci retracement",
};

/** Kinds placed with a single click; the others need two points. */
export const ONE_POINT: ReadonlySet<DrawingKind> = new Set(["hline", "vline"]);

const pointSchema = z.object({ t: z.number().finite(), p: z.number().finite() });
const drawingSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(DRAWING_KINDS),
  a: pointSchema,
  b: pointSchema.optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export type Drawing = z.infer<typeof drawingSchema>;

export const DRAWING_COLORS = ["#4d94ff", "#f59e0b", "#26b07e", "#e5484d", "#a855f7", "#e2e8f0"];
const MAX_DRAWINGS = 200;
const key = (symbol: string) => `wm-drawings:${symbol}`;

/** Drawings are saved per coin on this device, so they appear on every timeframe. */
export function loadDrawings(symbol: string): Drawing[] {
  try {
    const parsed = z
      .array(drawingSchema)
      .safeParse(JSON.parse(localStorage.getItem(key(symbol)) ?? "[]"));
    return parsed.success ? parsed.data.slice(0, MAX_DRAWINGS) : [];
  } catch {
    return [];
  }
}

export function saveDrawings(symbol: string, drawings: Drawing[]): void {
  try {
    if (drawings.length === 0) localStorage.removeItem(key(symbol));
    else localStorage.setItem(key(symbol), JSON.stringify(drawings.slice(-MAX_DRAWINGS)));
  } catch {
    // storage unavailable: drawings last for this visit only
  }
}

export type Handle = "a" | "b" | "body";
export interface Hit {
  id: string;
  handle: Handle;
}

type DrawTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];
const TOLERANCE = 7;

/**
 * Renders the drawings on the main price pane and answers "what is under the pointer" for
 * selecting and dragging. Interaction lives in the chart component; this class only projects
 * and paints.
 */
export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private axis: TimeAxis | null = null;
  private drawings: Drawing[] = [];
  private draft: Drawing | null = null;
  private selected: string | null = null;
  private visible = true;
  private precision = 2;
  private size = { width: 0, height: 0 };
  private readonly views: readonly IPrimitivePaneView[];
  private axisViews: readonly ISeriesPrimitiveAxisView[] = [];

  constructor() {
    const renderer: IPrimitivePaneRenderer = { draw: (t) => this.draw(t) };
    this.views = [{ renderer: () => renderer, zOrder: () => "top" }];
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.axisViews;
  }

  updateAllViews(): void {
    // Horizontal lines get a price label on the axis, like TradingView.
    const all = this.draft ? [...this.drawings, this.draft] : this.drawings;
    this.axisViews = this.visible
      ? all
          .filter((d) => d.kind === "hline")
          .map((d) => ({
            coordinate: () => this.series?.priceToCoordinate(d.a.p) ?? -100,
            text: () => d.a.p.toFixed(this.precision),
            textColor: () => "#ffffff",
            backColor: () => d.color,
          }))
      : [];
  }

  set(state: {
    axis?: TimeAxis;
    drawings?: Drawing[];
    draft?: Drawing | null;
    selected?: string | null;
    visible?: boolean;
    precision?: number;
  }): void {
    if (state.axis) this.axis = state.axis;
    if (state.drawings) this.drawings = state.drawings;
    if (state.draft !== undefined) this.draft = state.draft;
    if (state.selected !== undefined) this.selected = state.selected;
    if (state.visible !== undefined) this.visible = state.visible;
    if (state.precision !== undefined) this.precision = state.precision;
    this.updateAllViews();
    this.requestUpdate?.();
  }

  /** Chart point under a pane coordinate (fractional candle position, exact price). */
  toPoint(x: number, y: number): ChartPoint | null {
    const scale = this.scaleX();
    const price = this.series?.coordinateToPrice(y);
    if (!scale || !this.axis || price === null || price === undefined) return null;
    return { t: this.axis.toTime((x - scale.x0) / scale.spacing), p: price };
  }

  /** Pane coordinates of a chart point. */
  toXY(pt: ChartPoint): { x: number; y: number } | null {
    const scale = this.scaleX();
    const y = this.series?.priceToCoordinate(pt.p);
    if (!scale || !this.axis || y === null || y === undefined) return null;
    return { x: scale.x0 + this.axis.toLogical(pt.t) * scale.spacing, y };
  }

  /** Nearest drawing (or its end handle) under the pointer; the selected one wins ties. */
  pick(x: number, y: number): Hit | null {
    if (!this.visible) return null;
    const order = [...this.drawings].sort(
      (a, b) => Number(b.id === this.selected) - Number(a.id === this.selected),
    );
    for (const d of order) {
      const h = this.hitOne(d, x, y);
      if (h) return { id: d.id, handle: h };
    }
    return null;
  }

  private hitOne(d: Drawing, x: number, y: number): Handle | null {
    const a = this.toXY(d.a);
    if (!a) return null;
    const b = d.b ? this.toXY(d.b) : null;
    const near = (p: { x: number; y: number } | null) =>
      p !== null && Math.hypot(p.x - x, p.y - y) <= TOLERANCE + 2;
    if (d.kind === "hline") return Math.abs(y - a.y) <= TOLERANCE ? "body" : null;
    if (d.kind === "vline") return Math.abs(x - a.x) <= TOLERANCE ? "body" : null;
    if (!b) return null;
    if (near(a)) return "a";
    if (near(b)) return "b";
    if (d.kind === "trend")
      return distToSegment(x, y, a.x, a.y, b.x, b.y) <= TOLERANCE ? "body" : null;
    if (d.kind === "ray") {
      const e = rayEnd(a.x, a.y, b.x, b.y, this.size.width, this.size.height);
      return distToSegment(x, y, a.x, a.y, e.x, e.y) <= TOLERANCE ? "body" : null;
    }
    const left = Math.min(a.x, b.x) - TOLERANCE;
    const right = Math.max(a.x, b.x) + TOLERANCE;
    const top = Math.min(a.y, b.y) - TOLERANCE;
    const bottom = Math.max(a.y, b.y) + TOLERANCE;
    return x >= left && x <= right && y >= top && y <= bottom ? "body" : null;
  }

  private scaleX(): { x0: number; spacing: number } | null {
    const ts = this.chart?.timeScale();
    const x0 = ts?.logicalToCoordinate(0 as Logical);
    const x1 = ts?.logicalToCoordinate(1 as Logical);
    if (x0 === null || x0 === undefined || x1 === null || x1 === undefined || x1 === x0)
      return null;
    return { x0, spacing: x1 - x0 };
  }

  private draw(target: DrawTarget): void {
    if (!this.visible) return;
    // biome-ignore lint/correctness/useHookAtTopLevel: a canvas API (fancy-canvas), not a React hook
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      this.size = mediaSize;
      const all = this.draft ? [...this.drawings, this.draft] : this.drawings;
      for (const d of all) this.paint(ctx, d, d.id === this.selected || d === this.draft);
    });
  }

  private paint(ctx: CanvasRenderingContext2D, d: Drawing, active: boolean): void {
    const a = this.toXY(d.a);
    if (!a) return;
    const b = d.b ? this.toXY(d.b) : null;
    const { width, height } = this.size;
    ctx.save();
    ctx.strokeStyle = d.color;
    ctx.fillStyle = d.color;
    ctx.lineWidth = active ? 2 : 1.5;
    ctx.font = "11px 'IBM Plex Mono', ui-monospace, monospace";
    const line = (x1: number, y1: number, x2: number, y2: number) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    switch (d.kind) {
      case "hline":
        line(0, a.y, width, a.y);
        break;
      case "vline":
        line(a.x, 0, a.x, height);
        break;
      case "trend":
        if (b) line(a.x, a.y, b.x, b.y);
        break;
      case "ray":
        if (b) {
          const e = rayEnd(a.x, a.y, b.x, b.y, width, height);
          line(a.x, a.y, e.x, e.y);
        }
        break;
      case "rect":
        if (b) {
          ctx.globalAlpha = 0.12;
          ctx.fillRect(
            Math.min(a.x, b.x),
            Math.min(a.y, b.y),
            Math.abs(b.x - a.x),
            Math.abs(b.y - a.y),
          );
          ctx.globalAlpha = 1;
          ctx.strokeRect(
            Math.min(a.x, b.x),
            Math.min(a.y, b.y),
            Math.abs(b.x - a.x),
            Math.abs(b.y - a.y),
          );
        }
        break;
      case "fib":
        if (b && d.b) this.paintFib(ctx, d, a, b);
        break;
    }
    if (active && b) {
      for (const p of [a, b]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "#0b1020";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private paintFib(
    ctx: CanvasRenderingContext2D,
    d: Drawing,
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): void {
    if (!d.b) return;
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    const levels = fibPrices(d.a.p, d.b.p);
    const ys = levels.map((l) => this.series?.priceToCoordinate(l.price) ?? null);
    // Light bands between levels, then the level lines with their labels.
    for (let i = 0; i < levels.length - 1; i++) {
      const y1 = ys[i];
      const y2 = ys[i + 1];
      if (y1 === null || y1 === undefined || y2 === null || y2 === undefined) continue;
      ctx.globalAlpha = i % 2 === 0 ? 0.08 : 0.04;
      ctx.fillRect(left, Math.min(y1, y2), right - left, Math.abs(y2 - y1));
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.textBaseline = "bottom";
    levels.forEach((l, i) => {
      const y = ys[i];
      if (y === null || y === undefined) return;
      ctx.globalAlpha = l.level === 0.5 || l.level === 0.618 ? 1 : 0.75;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillText(`${FIB_LEVELS[i]} (${l.price.toFixed(this.precision)})`, left + 4, y - 2);
    });
    ctx.globalAlpha = 1;
  }
}
