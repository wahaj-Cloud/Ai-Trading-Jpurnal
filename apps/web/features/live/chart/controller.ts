import type { LiquidationMapDto, OpenPositionDto } from "@atc/shared";
import { heikinAshi } from "@atc/ta/indicators";
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  createTextWatermark,
  HistogramSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ITextWatermarkPluginApi,
  LineSeries,
  LineStyle,
  type Logical,
  PriceScaleMode,
  type SeriesType,
  TickMarkType,
  type Time,
} from "lightweight-charts";
import { alpha } from "@/features/charts/time-series-chart";
import {
  INTERVAL_SECONDS,
  type LiveCandle,
  type LiveInterval,
  symbolLabel,
  TRADFI_NAMES,
} from "../market";
import { livePnl, positionMatch } from "../positions";
import { CountdownPrimitive } from "./countdown";
import { DrawingsPrimitive } from "./drawings";
import { type ChartPoint, TimeAxis } from "./geometry";
import { HeatmapPrimitive } from "./heatmap";
import type { ChartSettings, ChartType } from "./settings";
import { computeStudies, type StudyLine, studyPanes, toTaCandles } from "./studies";

export const PANE_HEIGHT = 130;
const STUDY_THROTTLE_MS = 300;
const LABEL_THROTTLE_MS = 1000;

export interface ThemeColors {
  muted: string;
  rule: string;
  accent: string;
}

export interface LegendRow {
  label: string;
  color: string;
  value: number | null;
  pane: StudyLine["pane"];
}

export interface Legend {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number | null;
  studies: LegendRow[];
}

const usd = (v: number) =>
  `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function pricePrecision(symbol: string, price: number): number {
  if (TRADFI_NAMES[symbol]) return price >= 100 ? 2 : 3;
  return price >= 1000 ? 1 : price >= 1 ? 3 : price >= 0.01 ? 5 : 8;
}

function formatters(timezone: "local" | "utc") {
  const tz = timezone === "utc" ? "UTC" : undefined;
  const make = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { ...o, timeZone: tz, hourCycle: "h23" });
  const full = make({
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const year = make({ year: "numeric" });
  const month = make({ month: "short" });
  const day = make({ day: "numeric", month: "short" });
  const time = make({ hour: "2-digit", minute: "2-digit" });
  const secs = make({ hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const d = (t: Time) => new Date((t as number) * 1000);
  return {
    timeFormatter: (t: Time) => full.format(d(t)),
    tickMarkFormatter: (t: Time, type: TickMarkType) => {
      switch (type) {
        case TickMarkType.Year:
          return year.format(d(t));
        case TickMarkType.Month:
          return month.format(d(t));
        case TickMarkType.DayOfMonth:
          return day.format(d(t));
        case TickMarkType.TimeWithSeconds:
          return secs.format(d(t));
        default:
          return time.format(d(t));
      }
    },
  };
}

/**
 * Owns one lightweight-charts instance: candles, volume, indicators and their panels, the
 * trader's position lines, the countdown and the drawings overlay. React talks to it through
 * plain method calls, so the 4-10 price updates a second never re-render React.
 */
export class ChartController {
  readonly chart: IChartApi;
  readonly drawings = new DrawingsPrimitive();
  private readonly countdown = new CountdownPrimitive();
  private readonly heatmap = new HeatmapPrimitive((pt) => this.drawings.toXY(pt));
  private main: ISeriesApi<SeriesType>;
  private mainType: ChartType;
  private volume: ISeriesApi<"Histogram"> | null = null;
  private studySeries = new Map<string, ISeriesApi<SeriesType>>();
  private watermark: ITextWatermarkPluginApi<Time> | null = null;
  private rows: LiveCandle[] = [];
  private ha: LiveCandle[] = [];
  private studies: StudyLine[] = [];
  private positions: OpenPositionDto[] = [];
  /** Entry lines carry live P&L in their label (exact matches only); liquidation lines do not. */
  private posLines: Array<{ p: OpenPositionDto; line: IPriceLine; live: boolean }> = [];
  private lastStudyAt = 0;
  private lastLabelAt = 0;
  private precision = 2;
  private settings: ChartSettings;

  constructor(
    el: HTMLElement,
    readonly symbol: string,
    readonly interval: LiveInterval,
    settings: ChartSettings,
    private readonly colors: ThemeColors,
  ) {
    this.settings = settings;
    this.chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.muted,
        fontFamily: "IBM Plex Mono, ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: false,
        panes: {
          separatorColor: alpha(colors.rule, 0.8),
          separatorHoverColor: alpha(colors.accent, 0.3),
        },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 8 },
    });
    this.mainType = settings.type;
    this.main = this.createMain(settings.type);
    this.applySettings(settings, true);
  }

  destroy(): void {
    // Detach first: the countdown's timer must stop before the chart is disposed.
    this.main.detachPrimitive(this.countdown);
    this.main.detachPrimitive(this.drawings);
    this.main.detachPrimitive(this.heatmap);
    this.chart.remove();
  }

  // ─── Data ───

  setRows(rows: LiveCandle[]): void {
    this.rows = rows;
    const last = rows.at(-1);
    if (last) this.precision = pricePrecision(this.symbol, last.close);
    this.main.applyOptions({
      priceFormat: { type: "price", precision: this.precision, minMove: 10 ** -this.precision },
    });
    this.redrawAll();
    this.renderPositions();
    if (last) this.updateCountdown(last);
  }

  /** Adds older candles in front, keeping the view where the trader was looking. */
  prependRows(older: LiveCandle[]): number {
    const first = this.rows[0]?.time ?? Number.POSITIVE_INFINITY;
    const add = older.filter((c) => c.time < first);
    if (add.length === 0) return 0;
    const range = this.chart.timeScale().getVisibleLogicalRange();
    this.rows = [...add, ...this.rows];
    this.redrawAll();
    if (range) {
      this.chart.timeScale().setVisibleLogicalRange({
        from: (range.from + add.length) as Logical,
        to: (range.to + add.length) as Logical,
      });
    }
    return add.length;
  }

  get firstTime(): number | null {
    return this.rows[0]?.time ?? null;
  }

  get candleCount(): number {
    return this.rows.length;
  }

  /** One live update from the kline stream: the forming candle, or the first tick of a new one. */
  applyTick(c: LiveCandle): void {
    const last = this.rows.at(-1);
    if (last && c.time < last.time) return;
    const isNew = !last || c.time > last.time;
    if (isNew) this.rows.push(c);
    else this.rows[this.rows.length - 1] = c;

    if (this.mainType === "heikin") this.ha = this.haFor(this.rows);
    const i = this.rows.length - 1;
    this.main.update(this.mainPoint(i));
    this.volume?.update(this.volumePoint(i));
    this.updateCountdown(c);

    const now = Date.now();
    if (isNew) {
      // A candle just closed: refresh indicators in full so the closed candle has its final values.
      this.drawings.set({ axis: this.axis() });
      this.lastStudyAt = now;
      this.studies = computeStudies(this.rows, this.settings);
      for (const s of this.studies) this.studySeries.get(s.key)?.setData(this.studyData(s));
    } else if (now - this.lastStudyAt > STUDY_THROTTLE_MS) {
      this.lastStudyAt = now;
      this.studies = computeStudies(this.rows, this.settings);
      for (const s of this.studies) {
        const point = this.studyPoint(s, i);
        if (point) this.studySeries.get(s.key)?.update(point);
      }
    }
    if (now - this.lastLabelAt > LABEL_THROTTLE_MS) {
      this.lastLabelAt = now;
      this.updatePositionLabels(c.close);
    }
  }

  // ─── Settings ───

  applySettings(s: ChartSettings, initial = false): void {
    this.settings = s;
    const f = formatters(s.timezone);
    this.chart.applyOptions({
      grid: {
        vertLines: { visible: s.grid, color: alpha(this.colors.rule, 0.25) },
        horzLines: { visible: s.grid, color: alpha(this.colors.rule, 0.5) },
      },
      crosshair: {
        mode: s.magnet ? CrosshairMode.Magnet : CrosshairMode.Normal,
        vertLine: {
          color: this.colors.muted,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#1e2742",
        },
        horzLine: {
          color: this.colors.muted,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#1e2742",
        },
      },
      rightPriceScale: {
        mode: s.logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        scaleMargins: { top: 0.08, bottom: s.volume ? 0.2 : 0.08 },
      },
      localization: { timeFormatter: f.timeFormatter },
      timeScale: { tickMarkFormatter: f.tickMarkFormatter },
    });
    if (s.type !== this.mainType) {
      this.mainType = s.type;
      this.main.detachPrimitive(this.drawings);
      this.main.detachPrimitive(this.countdown);
      this.main.detachPrimitive(this.heatmap);
      this.chart.removeSeries(this.main);
      this.main = this.createMain(s.type);
      this.main.applyOptions({
        priceFormat: { type: "price", precision: this.precision, minMove: 10 ** -this.precision },
      });
      this.renderPositions();
    }
    this.main.applyOptions({ ...this.mainStyle(s.type, s), priceLineVisible: s.lastPriceLine });
    this.setWatermark(s.watermark);
    if (!initial) this.redrawAll();
    const last = this.rows.at(-1);
    if (last) this.updateCountdown(last);
  }

  /** The estimated liquidation map behind the candles (null hides it). */
  setLiquidationMap(map: LiquidationMapDto | null): void {
    this.heatmap.set(map);
  }

  // ─── Positions ───

  setPositions(positions: OpenPositionDto[]): void {
    this.positions = positions;
    this.renderPositions();
  }

  private renderPositions(): void {
    for (const { line } of this.posLines) this.main.removePriceLine(line);
    this.posLines = [];
    const { upColor, downColor } = this.settings;
    for (const p of this.positions) {
      const match = positionMatch(p, this.symbol);
      if (!match) continue;
      const color = p.direction === "LONG" ? upColor : downColor;
      if (p.entryPrice) {
        this.posLines.push({
          p,
          live: match === "exact",
          line: this.main.createPriceLine({
            price: Number(p.entryPrice),
            color,
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `Your ${p.direction.toLowerCase()}${match === "related" ? ` (${p.symbol})` : ""}`,
          }),
        });
      }
      if (p.liquidationPrice && Number(p.liquidationPrice) > 0 && match === "exact") {
        this.posLines.push({
          p,
          live: false,
          line: this.main.createPriceLine({
            price: Number(p.liquidationPrice),
            color: alpha(downColor, 0.8),
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: "Liquidation",
          }),
        });
      }
    }
    const last = this.rows.at(-1);
    if (last) this.updatePositionLabels(last.close);
  }

  private updatePositionLabels(price: number): void {
    for (const { p, line, live } of this.posLines) {
      if (!live) continue;
      const pnl = livePnl(p, price);
      line.applyOptions({
        title: `Your ${p.direction.toLowerCase()}${pnl === null ? "" : ` ${usd(pnl)}`}`,
      });
    }
  }

  // ─── Legend, drawing helpers, export ───

  legendAt(logical: number | null): Legend | null {
    const n = this.rows.length;
    if (n === 0) return null;
    const i = logical === null ? n - 1 : Math.max(0, Math.min(n - 1, Math.round(logical)));
    const r = this.rows[i] as LiveCandle;
    const prev = this.rows[i - 1];
    return {
      time: r.time,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
      change: prev ? r.close / prev.close - 1 : null,
      studies: this.studies
        .filter((s) => s.style !== "histogram")
        .map((s) => ({ label: s.label, color: s.color, value: s.values[i] ?? null, pane: s.pane })),
    };
  }

  /** Pointer position in the main price pane (not the axes or indicator panels), or null. */
  paneHit(x: number, y: number): boolean {
    const pane = this.chart.panes()[0];
    return x >= 0 && y >= 0 && x <= this.chart.timeScale().width() && y <= (pane?.getHeight() ?? 0);
  }

  /** Chart point under the pointer; with the magnet on, snaps to the nearest open/high/low/close. */
  pointAt(x: number, y: number): ChartPoint | null {
    const pt = this.drawings.toPoint(x, y);
    if (!pt || !this.settings.magnet || this.rows.length === 0) return pt;
    const axis = this.axis();
    const i = Math.round(axis.toLogical(pt.t));
    const row = this.rows[Math.max(0, Math.min(this.rows.length - 1, i))];
    if (!row) return pt;
    let best: { p: number; d: number } | null = null;
    for (const v of [row.open, row.high, row.low, row.close]) {
      const vy = this.main.priceToCoordinate(v);
      if (vy === null) continue;
      const d = Math.abs(vy - y);
      if (d <= 30 && (!best || d < best.d)) best = { p: v, d };
    }
    return best ? { t: row.time, p: best.p } : pt;
  }

  get pricePrecisionDigits(): number {
    return this.precision;
  }

  lockInteractions(locked: boolean): void {
    this.chart.applyOptions({ handleScroll: !locked, handleScale: !locked });
  }

  screenshot(): void {
    const canvas = this.chart.takeScreenshot(true, false);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `WickMentor-${this.symbol}-${this.interval}-${new Date().toISOString().slice(0, 16).replace(":", "")}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  }

  // ─── Internals ───

  private axis(): TimeAxis {
    return new TimeAxis(
      this.rows.map((r) => r.time),
      INTERVAL_SECONDS[this.interval],
    );
  }

  private haFor(rows: readonly LiveCandle[]): LiveCandle[] {
    const ha = heikinAshi(toTaCandles(rows));
    return ha.map((h, i) => ({
      ...(rows[i] as LiveCandle),
      open: h.o,
      high: h.h,
      low: h.l,
      close: h.c,
    }));
  }

  private createMain(type: ChartType): ISeriesApi<SeriesType> {
    const s = this.settings;
    const common = { priceLineVisible: s.lastPriceLine, lastValueVisible: true };
    let series: ISeriesApi<SeriesType>;
    if (type === "bars")
      series = this.chart.addSeries(BarSeries, { ...common, ...this.mainStyle(type, s) });
    else if (type === "line")
      series = this.chart.addSeries(LineSeries, { ...common, ...this.mainStyle(type, s) });
    else if (type === "area")
      series = this.chart.addSeries(AreaSeries, { ...common, ...this.mainStyle(type, s) });
    else
      series = this.chart.addSeries(CandlestickSeries, { ...common, ...this.mainStyle(type, s) });
    series.attachPrimitive(this.heatmap);
    series.attachPrimitive(this.drawings);
    series.attachPrimitive(this.countdown);
    return series;
  }

  private mainStyle(type: ChartType, s: ChartSettings): Record<string, unknown> {
    const up = s.upColor;
    const down = s.downColor;
    switch (type) {
      case "bars":
        return { upColor: up, downColor: down, thinBars: false };
      case "line":
        return { color: this.colors.accent, lineWidth: 2 };
      case "area":
        return {
          lineColor: this.colors.accent,
          topColor: alpha(this.colors.accent, 0.35),
          bottomColor: alpha(this.colors.accent, 0),
          lineWidth: 2,
        };
      case "hollow":
        return {
          upColor: "rgba(0,0,0,0)",
          downColor: down,
          borderVisible: true,
          borderUpColor: up,
          borderDownColor: down,
          wickUpColor: up,
          wickDownColor: down,
        };
      default:
        return {
          upColor: up,
          downColor: down,
          borderVisible: false,
          wickUpColor: up,
          wickDownColor: down,
        };
    }
  }

  private mainPoint(i: number) {
    const r = (this.mainType === "heikin" ? this.ha[i] : this.rows[i]) as LiveCandle;
    const time = r.time as Time;
    if (this.mainType === "line" || this.mainType === "area") return { time, value: r.close };
    return { time, open: r.open, high: r.high, low: r.low, close: r.close };
  }

  private volumePoint(i: number) {
    const r = this.rows[i] as LiveCandle;
    return {
      time: r.time as Time,
      value: r.volume,
      color: alpha(r.close >= r.open ? this.settings.upColor : this.settings.downColor, 0.4),
    };
  }

  private studyPoint(s: StudyLine, i: number) {
    const r = this.rows[i];
    if (!r) return null;
    const v = s.values[i];
    const time = r.time as Time;
    if (v === null || v === undefined) return { time };
    if (s.style === "histogram") {
      return {
        time,
        value: v,
        color: alpha(v >= 0 ? this.settings.upColor : this.settings.downColor, 0.6),
      };
    }
    return { time, value: v };
  }

  private studyData(s: StudyLine) {
    return this.rows.map((_, i) => this.studyPoint(s, i)).filter((p) => p !== null);
  }

  /** Full redraw: main series, volume, indicator series and panels, overlays. */
  private redrawAll(): void {
    if (this.mainType === "heikin") this.ha = this.haFor(this.rows);
    this.main.setData(this.rows.map((_, i) => this.mainPoint(i)));

    if (this.settings.volume) {
      if (!this.volume) {
        this.volume = this.chart.addSeries(HistogramSeries, {
          priceScaleId: "vol",
          priceFormat: { type: "volume" },
          lastValueVisible: false,
          priceLineVisible: false,
        });
        this.chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      }
      this.volume.setData(this.rows.map((_, i) => this.volumePoint(i)));
    } else if (this.volume) {
      this.chart.removeSeries(this.volume);
      this.volume = null;
    }

    for (const series of this.studySeries.values()) this.chart.removeSeries(series);
    this.studySeries.clear();
    for (let p = this.chart.panes().length - 1; p >= 1; p--) this.chart.removePane(p);

    this.studies = computeStudies(this.rows, this.settings);
    const panes = studyPanes(this.settings);
    for (const s of this.studies) {
      const paneIndex = s.pane === "price" ? 0 : panes.indexOf(s.pane) + 1;
      const opts = {
        color: s.color,
        priceLineVisible: false,
        lastValueVisible: s.pane !== "price",
        crosshairMarkerVisible: false,
        priceFormat:
          s.pane === "price"
            ? { type: "price" as const, precision: this.precision, minMove: 10 ** -this.precision }
            : { type: "price" as const, precision: 2, minMove: 0.01 },
      };
      const series =
        s.style === "histogram"
          ? this.chart.addSeries(HistogramSeries, opts, paneIndex)
          : this.chart.addSeries(
              LineSeries,
              {
                ...opts,
                lineWidth: 1,
                lineStyle: s.style === "dashed" ? LineStyle.Dashed : LineStyle.Solid,
              },
              paneIndex,
            );
      series.setData(this.studyData(s));
      if (s.key === "rsi") {
        for (const level of [70, 30]) {
          series.createPriceLine({
            price: level,
            color: alpha(this.colors.muted, 0.6),
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: false,
            title: "",
          });
        }
      }
      this.studySeries.set(s.key, series);
    }
    const allPanes = this.chart.panes();
    for (let p = 1; p < allPanes.length; p++) allPanes[p]?.setHeight(PANE_HEIGHT);

    this.drawings.set({ axis: this.axis(), precision: this.precision });
  }

  private setWatermark(on: boolean): void {
    const pane = this.chart.panes()[0];
    if (!pane) return;
    const text = `${symbolLabel(this.symbol)} · ${this.interval}`;
    if (!this.watermark) {
      this.watermark = createTextWatermark(pane, {
        horzAlign: "center",
        vertAlign: "center",
        lines: [{ text, color: alpha(this.colors.muted, 0.09), fontSize: 44, fontStyle: "600" }],
      });
    }
    this.watermark.applyOptions({ visible: on });
  }

  private updateCountdown(c: LiveCandle): void {
    this.countdown.set({
      closeTime: c.closeTime,
      price: c.close,
      color: c.close >= c.open ? this.settings.upColor : this.settings.downColor,
      visible: this.settings.countdown,
    });
  }
}
