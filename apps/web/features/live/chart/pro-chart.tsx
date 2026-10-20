"use client";

import type { LiquidationMapDto, OpenPositionDto } from "@atc/shared";
import { signedPct } from "@atc/shared";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cssVar } from "@/features/charts/time-series-chart";
import { useThemeKey } from "@/features/theme/use-theme-key";
import { cn } from "@/lib/cn";
import {
  BlockedError,
  type FeedStatus,
  fetchCandles,
  formatPrice,
  parseKline,
  useBinanceStream,
} from "../binance";
import type { LiveInterval } from "../market";
import { ChartController, type Legend, PANE_HEIGHT } from "./controller";
import {
  type Drawing,
  type DrawingKind,
  type Handle,
  loadDrawings,
  ONE_POINT,
  saveDrawings,
} from "./drawings";
import type { ChartPoint } from "./geometry";
import type { ChartSettings } from "./settings";
import { studyPanes } from "./studies";

export interface ProChartHandle {
  screenshot(): void;
  deleteSelected(): void;
  clearDrawings(): void;
}

const MAX_CANDLES = 6000;
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });

type Drag =
  | { mode: "create"; x: number; y: number }
  | { mode: "move"; id: string; handle: Handle; start: ChartPoint; orig: Drawing };

const newId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * The live chart: Binance candles streamed into a TradingView-style chart with indicators,
 * drawing tools, a candle-close countdown and the trader's own positions.
 */
export function ProChart({
  ref,
  symbol,
  interval,
  positions,
  settings,
  tool,
  drawColor,
  drawingsVisible,
  onToolDone,
  onStatus,
  onCandleClose,
  onSelectionChange,
  baseHeight = 480,
  fill = false,
  liqMap = null,
}: {
  ref?: Ref<ProChartHandle>;
  symbol: string;
  interval: LiveInterval;
  positions: OpenPositionDto[];
  settings: ChartSettings;
  tool: DrawingKind | null;
  drawColor: string;
  drawingsVisible: boolean;
  onToolDone: () => void;
  onStatus?: (s: FeedStatus | "loading" | "error") => void;
  /** Close time (ms) of the forming candle; called when a new candle starts. */
  onCandleClose?: (closeTime: number) => void;
  onSelectionChange?: (selected: boolean) => void;
  baseHeight?: number;
  /** Fill the parent's height (full screen) instead of a fixed height. */
  fill?: boolean;
  /** Estimated liquidation map to paint behind the candles. */
  liqMap?: LiquidationMapDto | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const ctrl = useRef<ChartController | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legend, setLegend] = useState<Legend | null>(null);
  const [cursor, setCursor] = useState<"" | "crosshair" | "move" | "pointer">("");
  const themeKey = useThemeKey();

  // Latest props for the imperative handlers, without re-binding them.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(drawColor);
  colorRef.current = drawColor;
  const cbRef = useRef({ onToolDone, onStatus, onCandleClose, onSelectionChange });
  cbRef.current = { onToolDone, onStatus, onCandleClose, onSelectionChange };

  const drawingsRef = useRef<Drawing[]>([]);
  const selectedRef = useRef<string | null>(null);
  const draftRef = useRef<Drawing | null>(null);
  const placingRef = useRef(false);
  const dragRef = useRef<Drag | null>(null);
  const lastCloseRef = useRef(0);

  const push = () =>
    ctrl.current?.drawings.set({
      drawings: drawingsRef.current,
      draft: draftRef.current,
      selected: selectedRef.current,
    });
  const select = (id: string | null) => {
    if (selectedRef.current === id) return;
    selectedRef.current = id;
    cbRef.current.onSelectionChange?.(id !== null);
  };
  const commit = (next: Drawing[]) => {
    drawingsRef.current = next;
    saveDrawings(symbol, next);
  };

  // Create the chart, load history, and page in older candles when scrolling left.
  // biome-ignore lint/correctness/useExhaustiveDependencies: settings are applied by the effect below; themeKey redraws in the new colours
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setReady(false);
    setError(null);
    cbRef.current.onStatus?.("loading");
    const c = new ChartController(el, symbol, interval, settingsRef.current, {
      muted: cssVar(el, "--color-ink-muted", "#8c99ac"),
      rule: cssVar(el, "--color-rule", "#233044"),
      accent: cssVar(el, "--color-coach", "#4d94ff"),
    });
    ctrl.current = c;
    c.setPositions(positions);
    drawingsRef.current = loadDrawings(symbol);
    selectedRef.current = null;
    draftRef.current = null;
    push();

    const abort = new AbortController();
    let loadingOlder = false;
    let exhausted = false;
    fetchCandles(symbol, interval, 1000, abort.signal)
      .then((rows) => {
        c.setRows(rows);
        c.chart.timeScale().scrollToRealTime();
        const last = rows.at(-1);
        if (last) {
          lastCloseRef.current = last.closeTime;
          cbRef.current.onCandleClose?.(last.closeTime);
        }
        setLegend(c.legendAt(null));
        setReady(true);
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        setError(
          err instanceof BlockedError
            ? "Binance does not serve live prices in your region."
            : "Could not load the chart. Check your connection and try again.",
        );
        cbRef.current.onStatus?.("error");
      });

    const onRange = (range: { from: number } | null) => {
      const first = c.firstTime;
      if (!range || range.from > 40 || loadingOlder || exhausted || first === null) return;
      if (c.candleCount >= MAX_CANDLES) return;
      loadingOlder = true;
      fetchCandles(symbol, interval, 1000, abort.signal, first * 1000 - 1)
        .then((older) => {
          if (c.prependRows(older) === 0) exhausted = true;
        })
        .catch(() => {
          exhausted = true;
        })
        .finally(() => {
          loadingOlder = false;
        });
    };
    c.chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    let frame = 0;
    const onMove = (p: { logical?: number }) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setLegend(c.legendAt(p.logical ?? null)));
    };
    c.chart.subscribeCrosshairMove(onMove);

    return () => {
      abort.abort();
      cancelAnimationFrame(frame);
      ctrl.current = null;
      c.destroy();
    };
  }, [symbol, interval, themeKey]);

  useEffect(() => {
    ctrl.current?.applySettings(settings);
    setLegend(ctrl.current?.legendAt(null) ?? null);
  }, [settings]);

  useEffect(() => {
    ctrl.current?.setPositions(positions);
  }, [positions]);

  // Re-applied after the chart is rebuilt (new coin, timeframe or theme).
  useEffect(() => {
    ctrl.current?.setLiquidationMap(ready ? liqMap : null);
  }, [liqMap, ready]);

  useEffect(() => {
    ctrl.current?.drawings.set({ visible: drawingsVisible });
  }, [drawingsVisible]);

  // Leaving drawing mode cancels a half-placed drawing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: push reads refs only
  useEffect(() => {
    if (tool === null && draftRef.current) {
      draftRef.current = null;
      placingRef.current = false;
      push();
    }
    setCursor(tool ? "crosshair" : "");
  }, [tool]);

  const status = useBinanceStream(
    ready ? [`${symbol.toLowerCase()}@kline_${interval}`] : [],
    (d) => {
      const k = parseKline(d);
      const c = ctrl.current;
      if (!k || !c) return;
      c.applyTick(k);
      if (k.closeTime !== lastCloseRef.current) {
        lastCloseRef.current = k.closeTime;
        cbRef.current.onCandleClose?.(k.closeTime);
      }
    },
  );
  useEffect(() => {
    if (ready) cbRef.current.onStatus?.(status);
  }, [ready, status]);

  // Drawing: pointer handling in the capture phase, so the chart does not pan while drawing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: handlers read refs; symbol re-binds storage
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const finish = () => {
      const d = draftRef.current;
      if (!d) return;
      draftRef.current = null;
      placingRef.current = false;
      commit([...drawingsRef.current, d]);
      select(d.id);
      push();
      cbRef.current.onToolDone();
    };
    const onDown = (e: PointerEvent) => {
      const c = ctrl.current;
      if (!c || e.button !== 0) return;
      const { x, y } = local(e);
      if (!c.paneHit(x, y)) return;
      const pt = c.pointAt(x, y);
      if (!pt) return;
      const kind = toolRef.current;
      if (placingRef.current && draftRef.current) {
        e.stopPropagation();
        draftRef.current = { ...draftRef.current, b: pt };
        finish();
        return;
      }
      if (kind) {
        e.stopPropagation();
        c.lockInteractions(true);
        const d: Drawing = { id: newId(), kind, a: pt, color: colorRef.current };
        if (ONE_POINT.has(kind)) {
          draftRef.current = d;
          finish();
          c.lockInteractions(false);
          return;
        }
        draftRef.current = { ...d, b: pt };
        dragRef.current = { mode: "create", x, y };
        push();
        return;
      }
      const hit = c.drawings.pick(x, y);
      if (hit) {
        e.stopPropagation();
        c.lockInteractions(true);
        const orig = drawingsRef.current.find((d) => d.id === hit.id);
        if (!orig) return;
        select(hit.id);
        dragRef.current = { mode: "move", id: hit.id, handle: hit.handle, start: pt, orig };
        push();
      } else if (selectedRef.current) {
        select(null);
        push();
      }
    };
    const onMove = (e: PointerEvent) => {
      const c = ctrl.current;
      if (!c) return;
      const { x, y } = local(e);
      const drag = dragRef.current;
      const pt = c.pointAt(x, y);
      if (drag?.mode === "create" && draftRef.current && pt) {
        draftRef.current = { ...draftRef.current, b: pt };
        push();
        return;
      }
      if (drag?.mode === "move" && pt) {
        const { orig, handle, start } = drag;
        const dt = pt.t - start.t;
        const dp = pt.p - start.p;
        const moved: Drawing =
          handle === "a"
            ? { ...orig, a: pt }
            : handle === "b"
              ? { ...orig, b: pt }
              : {
                  ...orig,
                  a: { t: orig.a.t + dt, p: orig.a.p + dp },
                  ...(orig.b ? { b: { t: orig.b.t + dt, p: orig.b.p + dp } } : {}),
                };
        drawingsRef.current = drawingsRef.current.map((d) => (d.id === orig.id ? moved : d));
        push();
        return;
      }
      if (placingRef.current && draftRef.current && pt) {
        draftRef.current = { ...draftRef.current, b: pt };
        push();
      }
      if (!toolRef.current && c.paneHit(x, y)) {
        const hit = c.drawings.pick(x, y);
        setCursor(hit ? (hit.handle === "body" ? "move" : "pointer") : "");
      }
    };
    const onUp = (e: PointerEvent) => {
      const c = ctrl.current;
      const drag = dragRef.current;
      if (!c || !drag) return;
      dragRef.current = null;
      c.lockInteractions(false);
      if (drag.mode === "create") {
        const { x, y } = local(e);
        // A click without dragging: place the second point with the next click.
        if (Math.hypot(x - drag.x, y - drag.y) < 5) placingRef.current = true;
        else finish();
      } else {
        commit(drawingsRef.current);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "Escape") {
        if (draftRef.current) {
          draftRef.current = null;
          placingRef.current = false;
        }
        select(null);
        push();
        if (toolRef.current) cbRef.current.onToolDone();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedRef.current) {
        e.preventDefault();
        const id = selectedRef.current;
        commit(drawingsRef.current.filter((d) => d.id !== id));
        select(null);
        push();
      }
    };
    el.addEventListener("pointerdown", onDown, { capture: true });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("pointerdown", onDown, { capture: true });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [symbol]);

  useImperativeHandle(ref, () => ({
    screenshot: () => ctrl.current?.screenshot(),
    deleteSelected: () => {
      const id = selectedRef.current;
      if (!id) return;
      commit(drawingsRef.current.filter((d) => d.id !== id));
      select(null);
      push();
    },
    clearDrawings: () => {
      commit([]);
      select(null);
      push();
    },
  }));

  const panes = studyPanes(settings).length;
  const height = baseHeight + panes * PANE_HEIGHT;
  const digits = ctrl.current?.pricePrecisionDigits;
  const fmt = (v: number) =>
    digits === undefined
      ? formatPrice(v)
      : v.toLocaleString("en", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const up = legend ? legend.close >= legend.open : true;

  return (
    <div className={cn("relative min-w-0", fill && "h-full")}>
      <div
        ref={box}
        data-cursor={cursor || undefined}
        style={fill ? undefined : { height }}
        className={cn("wm-chart w-full", fill && "h-full", tool && "touch-none")}
        role="img"
        aria-label={`Live ${symbol} ${interval} chart${tool ? `, drawing mode` : ""}`}
      />
      {legend && !error && (
        <div className="figures pointer-events-none absolute top-1 left-1 z-10 grid max-w-[calc(100%-5rem)] gap-0.5 rounded-md bg-sheet/60 px-1.5 py-1 text-[11px] leading-tight backdrop-blur-[1px]">
          <p className="flex flex-wrap gap-x-2">
            <span className="text-ink-muted">
              O <span className={up ? "text-profit" : "text-loss"}>{fmt(legend.open)}</span>
            </span>
            <span className="text-ink-muted">
              H <span className={up ? "text-profit" : "text-loss"}>{fmt(legend.high)}</span>
            </span>
            <span className="text-ink-muted">
              L <span className={up ? "text-profit" : "text-loss"}>{fmt(legend.low)}</span>
            </span>
            <span className="text-ink-muted">
              C <span className={up ? "text-profit" : "text-loss"}>{fmt(legend.close)}</span>
            </span>
            {legend.change !== null && (
              <span className={legend.change >= 0 ? "text-profit" : "text-loss"}>
                {signedPct(legend.change * 100, 2)}
              </span>
            )}
            {settings.volume && (
              <span className="text-ink-muted">
                Vol <span className="text-ink">{compact.format(legend.volume)}</span>
              </span>
            )}
          </p>
          {legend.studies.length > 0 && (
            <p className="hidden flex-wrap gap-x-2.5 sm:flex">
              {legend.studies.map((s) => (
                <span key={s.label} style={{ color: s.color }}>
                  {s.label}{" "}
                  {s.value === null ? "—" : s.pane === "price" ? fmt(s.value) : s.value.toFixed(2)}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink-muted">
          {error}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {tool
          ? `Drawing mode. Click on the chart to place the ${tool} line. Escape to cancel.`
          : ""}
      </span>
    </div>
  );
}
