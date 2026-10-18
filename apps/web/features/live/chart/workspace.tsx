"use client";

import type { OpenPositionDto } from "@atc/shared";
import {
  Activity,
  AlignVerticalSpaceAround,
  Camera,
  ChartCandlestick,
  Clock,
  Eye,
  EyeOff,
  Flame,
  Magnet,
  Maximize,
  Minimize,
  Minus,
  MousePointer2,
  MoveUpRight,
  RectangleHorizontal,
  SeparatorVertical,
  Settings2,
  Slash,
  Trash2,
} from "lucide-react";
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";
import type { FeedStatus } from "../binance";
import { LIVE_INTERVALS, type LiveInterval, QUICK_INTERVALS, TRADFI_NAMES } from "../market";
import { DRAWING_COLORS, DRAWING_LABELS, type DrawingKind } from "./drawings";
import { NextEventChip } from "./event-chip";
import { formatCountdown } from "./geometry";
import { LiqMapCard, mapOf, useLiquidationMap } from "./liq-map";
import { IndicatorsPanel, SettingsPanel } from "./panels";
import { ProChart, type ProChartHandle } from "./pro-chart";
import {
  CHART_TYPE_LABELS,
  CHART_TYPES,
  type ChartSettings,
  type ChartType,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
} from "./settings";
import { studyPanes } from "./studies";
import { SPOT_ALTERNATIVES, TradingViewChart, tvSymbol } from "./tradingview";

type Engine = "wm" | "tv";
const ENGINE_KEY = "wm-chart-engine";

const TOOLS: Array<{
  kind: DrawingKind | null;
  icon: ComponentType<{ className?: string }>;
  label: string;
}> = [
  { kind: null, icon: MousePointer2, label: "Cursor (select and move drawings)" },
  { kind: "trend", icon: Slash, label: DRAWING_LABELS.trend },
  { kind: "ray", icon: MoveUpRight, label: DRAWING_LABELS.ray },
  { kind: "hline", icon: Minus, label: DRAWING_LABELS.hline },
  { kind: "vline", icon: SeparatorVertical, label: DRAWING_LABELS.vline },
  { kind: "rect", icon: RectangleHorizontal, label: DRAWING_LABELS.rect },
  { kind: "fib", icon: AlignVerticalSpaceAround, label: DRAWING_LABELS.fib },
];

const iconBtn = (active = false) =>
  cn(
    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] transition-colors",
    active ? "bg-coach/20 text-coach" : "text-ink-muted hover:bg-hi/[0.08] hover:text-ink",
  );

function Countdown({ closeTime }: { closeTime: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!closeTime) return null;
  return (
    <span
      className="figures inline-flex h-8 items-center gap-1.5 rounded-full border border-rule px-2.5 text-xs text-ink-muted"
      title="Time until the current candle closes"
    >
      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="hidden sm:inline">Closes in</span>
      <span className="text-ink tabular-nums">{formatCountdown(closeTime + 1 - Date.now())}</span>
    </span>
  );
}

/**
 * The chart area of Live Markets: TradingView-style toolbar (timeframes, chart type, indicators,
 * settings), drawing tools, candle countdown, screenshot and full screen. "TradingView" switches
 * to TradingView's own embedded chart for its complete toolset and spot gold.
 */
export function ChartWorkspace({
  symbol,
  interval,
  positions,
  onInterval,
  onStatus,
  header,
  price = null,
  children,
}: {
  symbol: string;
  interval: LiveInterval;
  positions: OpenPositionDto[];
  onInterval: (tf: LiveInterval) => void;
  onStatus?: (s: FeedStatus | "loading" | "error") => void;
  header: ReactNode;
  /** Latest price, for distances to liquidation clusters. */
  price?: number | null;
  children?: ReactNode;
}) {
  const [settings, setSettings] = useState<ChartSettings>(DEFAULT_SETTINGS);
  const [engine, setEngine] = useState<Engine>("wm");
  const [spot, setSpot] = useState(false);
  const [tool, setTool] = useState<DrawingKind | null>(null);
  const [drawColor, setDrawColor] = useState(DRAWING_COLORS[0] as string);
  const [drawingsVisible, setDrawingsVisible] = useState(true);
  const [hasSelection, setHasSelection] = useState(false);
  const [panel, setPanel] = useState<"indicators" | "settings" | null>(null);
  const [closeTime, setCloseTime] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewport, setViewport] = useState({ w: 1280, h: 900 });
  const section = useRef<HTMLElement>(null);
  const chart = useRef<ProChartHandle>(null);

  // Saved preferences are read after mount so the server and browser render the same first frame.
  useEffect(() => {
    setSettings(loadSettings());
    try {
      if (localStorage.getItem(ENGINE_KEY) === "tv") setEngine("tv");
    } catch {
      // storage unavailable
    }
  }, []);

  useEffect(() => {
    const read = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    read();
    const onFs = () => setFullscreen(document.fullscreenElement === section.current);
    window.addEventListener("resize", read);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("resize", read);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);

  const update = useCallback((next: ChartSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);
  const chooseEngine = (e: Engine) => {
    setEngine(e);
    setTool(null);
    try {
      localStorage.setItem(ENGINE_KEY, e);
    } catch {
      // storage unavailable
    }
  };
  // Panels open over the page, which full screen hides, so leave full screen first.
  const openPanel = (p: "indicators" | "settings") => {
    if (document.fullscreenElement) void document.exitFullscreen();
    setPanel(p);
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void section.current?.requestFullscreen?.();
  };

  const liqState = useLiquidationMap(
    symbol,
    settings.liqMap.on && engine === "wm",
    settings.liqMap.window,
  );
  const setLiq = (patch: Partial<ChartSettings["liqMap"]>) =>
    update({ ...settings, liqMap: { ...settings.liqMap, ...patch } });

  const panes = studyPanes(settings).length;
  const baseHeight = fullscreen
    ? Math.max(320, viewport.h - 150 - panes * 130)
    : viewport.w < 640
      ? 380
      : 480;
  const spotAlt = SPOT_ALTERNATIVES[symbol];
  const activeIndicators =
    settings.mas.filter((m) => m.on).length +
    Number(settings.bollinger.on) +
    Number(settings.vwap.on) +
    Number(settings.rsi.on) +
    Number(settings.macd.on);
  const moreValue = (QUICK_INTERVALS as readonly string[]).includes(interval) ? "" : interval;

  return (
    <section
      ref={section}
      className={cn(
        "surface grid min-w-0 content-start gap-3 rounded-[var(--radius-surface)] p-3 sm:p-4",
        fullscreen && "h-dvh overflow-y-auto rounded-none bg-sheet",
      )}
    >
      {header}

      {/* Top toolbar */}
      <div className="relative -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
        <fieldset className="flex shrink-0 gap-0.5 rounded-full border border-rule p-0.5">
          <legend className="sr-only">Timeframe</legend>
          {QUICK_INTERVALS.map((tf) => (
            <button
              key={tf}
              type="button"
              aria-pressed={tf === interval}
              onClick={() => onInterval(tf)}
              className={cn(
                "h-7 rounded-full px-2.5 text-xs",
                tf === interval
                  ? "bg-coach/15 font-medium text-ink"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {tf}
            </button>
          ))}
          <label className="relative">
            <span className="sr-only">More timeframes</span>
            <select
              value={moreValue}
              onChange={(e) => e.target.value && onInterval(e.target.value as LiveInterval)}
              className={cn(
                "h-7 cursor-pointer appearance-none rounded-full bg-transparent px-2.5 text-xs",
                moreValue ? "bg-coach/15 font-medium text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              <option value="">More ▾</option>
              {LIVE_INTERVALS.filter(
                (tf) => !(QUICK_INTERVALS as readonly string[]).includes(tf),
              ).map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        {engine === "wm" && (
          <>
            <label className="relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-rule pr-2 pl-2.5 text-xs text-ink-muted hover:text-ink">
              <ChartCandlestick className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Chart type</span>
              <select
                value={settings.type}
                onChange={(e) => update({ ...settings, type: e.target.value as ChartType })}
                className="cursor-pointer appearance-none bg-transparent pr-1 text-ink"
              >
                {CHART_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CHART_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => openPanel("indicators")}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-rule px-2.5 text-xs text-ink-muted hover:text-ink"
            >
              <Activity className="h-4 w-4" aria-hidden="true" />
              Indicators
              {activeIndicators > 0 && (
                <span className="figures rounded-full bg-coach/20 px-1.5 text-[10px] text-coach">
                  {activeIndicators}
                </span>
              )}
            </button>
            <button
              type="button"
              aria-pressed={settings.liqMap.on}
              onClick={() => setLiq({ on: !settings.liqMap.on })}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs",
                settings.liqMap.on
                  ? "border-[#f59e0b]/60 bg-[#f59e0b]/10 text-ink"
                  : "border-rule text-ink-muted hover:text-ink",
              )}
              title="Estimated liquidation map"
            >
              <Flame className="h-4 w-4 text-[#f59e0b]" aria-hidden="true" />
              Liq. map
            </button>
            <button
              type="button"
              onClick={() => openPanel("settings")}
              className={iconBtn()}
              title="Chart settings"
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Chart settings</span>
            </button>
            {settings.countdown && <Countdown closeTime={closeTime} />}
          </>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <NextEventChip symbol={symbol} />
          {engine === "wm" && (
            <button
              type="button"
              onClick={() => chart.current?.screenshot()}
              className={iconBtn()}
              title="Save chart image"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Save chart image</span>
            </button>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            className={iconBtn(fullscreen)}
            title={fullscreen ? "Exit full screen" : "Full screen"}
          >
            {fullscreen ? (
              <Minimize className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Maximize className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="sr-only">{fullscreen ? "Exit full screen" : "Full screen"}</span>
          </button>
          <fieldset className="flex gap-0.5 rounded-full border border-rule p-0.5">
            <legend className="sr-only">Chart engine</legend>
            {(
              [
                ["wm", "WickMentor"],
                ["tv", "TradingView"],
              ] as const
            ).map(([e, label]) => (
              <button
                key={e}
                type="button"
                aria-pressed={engine === e}
                onClick={() => chooseEngine(e)}
                className={cn(
                  "h-7 rounded-full px-2.5 text-xs whitespace-nowrap",
                  engine === e
                    ? "bg-coach/15 font-medium text-ink"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </fieldset>
        </div>
      </div>

      {engine === "tv" ? (
        <div className="grid gap-2">
          {spotAlt && (
            <fieldset className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              <legend className="sr-only">{TRADFI_NAMES[symbol]} price feed</legend>
              Feed:
              {(
                [
                  [false, `Binance ${symbol} perpetual`],
                  [true, spotAlt.label],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={spot === v}
                  onClick={() => setSpot(v)}
                  className={cn(
                    "h-7 rounded-full border px-2.5",
                    spot === v ? "border-coach text-ink" : "border-rule hover:text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </fieldset>
          )}
          <TradingViewChart
            symbol={spot && spotAlt ? spotAlt.tv : tvSymbol(symbol)}
            interval={interval}
            height={baseHeight + 60}
          />
          <p className="text-xs text-ink-faint">
            TradingView's own chart, with all its drawing tools and indicators. Your positions and
            the WickMentor countdown show on the WickMentor chart.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[auto_minmax(0,1fr)]">
          {/* Drawing tools: a column on desktop, a row on phones. */}
          <div
            role="toolbar"
            aria-label="Drawing tools"
            aria-orientation={viewport.w < 640 ? "horizontal" : "vertical"}
            className="relative flex gap-1 overflow-x-auto rounded-[var(--radius-control)] border border-rule p-1 sm:flex-col sm:self-start sm:overflow-visible"
          >
            {TOOLS.map(({ kind, icon: Icon, label }) => (
              <button
                key={label}
                type="button"
                aria-pressed={tool === kind}
                onClick={() => setTool(kind)}
                className={iconBtn(tool === kind)}
                title={label}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{label}</span>
              </button>
            ))}
            <span
              className="mx-0.5 w-px shrink-0 bg-rule sm:mx-0 sm:my-0.5 sm:h-px sm:w-auto"
              aria-hidden="true"
            />
            <label className={cn(iconBtn(), "relative cursor-pointer")} title="Drawing colour">
              <span
                className="h-4 w-4 rounded-full border border-hi/30"
                style={{ background: drawColor }}
              />
              <select
                value={drawColor}
                onChange={(e) => setDrawColor(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="Drawing colour"
              >
                {DRAWING_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              aria-pressed={settings.magnet}
              onClick={() => update({ ...settings, magnet: !settings.magnet })}
              className={iconBtn(settings.magnet)}
              title="Magnet: snap to candle open, high, low and close"
            >
              <Magnet className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Magnet</span>
            </button>
            <button
              type="button"
              aria-pressed={!drawingsVisible}
              onClick={() => setDrawingsVisible((v) => !v)}
              className={iconBtn(!drawingsVisible)}
              title={drawingsVisible ? "Hide drawings" : "Show drawings"}
            >
              {drawingsVisible ? (
                <Eye className="h-4 w-4" aria-hidden="true" />
              ) : (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="sr-only">{drawingsVisible ? "Hide drawings" : "Show drawings"}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (hasSelection) chart.current?.deleteSelected();
                else if (window.confirm(`Remove all drawings on ${symbol}?`))
                  chart.current?.clearDrawings();
              }}
              className={iconBtn()}
              title={hasSelection ? "Delete selected drawing" : "Remove all drawings"}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">
                {hasSelection ? "Delete selected drawing" : "Remove all drawings"}
              </span>
            </button>
          </div>

          <div className="relative min-w-0">
            {tool && (
              <p className="pointer-events-none absolute top-1 right-16 z-20 rounded-full bg-coach px-3 py-1 text-xs font-medium text-coach-ink shadow">
                {tool === "hline" || tool === "vline"
                  ? "Click the chart to place the line"
                  : "Click two points (or drag) · Esc to cancel"}
              </p>
            )}
            <ProChart
              ref={chart}
              symbol={symbol}
              interval={interval}
              positions={positions}
              settings={settings}
              tool={tool}
              drawColor={drawColor}
              drawingsVisible={drawingsVisible}
              onToolDone={() => setTool(null)}
              onStatus={onStatus}
              onCandleClose={setCloseTime}
              onSelectionChange={setHasSelection}
              baseHeight={baseHeight}
              liqMap={settings.liqMap.on ? mapOf(liqState) : null}
            />
          </div>
        </div>
      )}

      {engine === "wm" && settings.liqMap.on && (
        <LiqMapCard
          state={liqState}
          window={settings.liqMap.window}
          onWindow={(w) => setLiq({ window: w })}
          onClose={() => setLiq({ on: false })}
          price={price}
        />
      )}

      {children}

      <IndicatorsPanel
        open={panel === "indicators"}
        onClose={() => setPanel(null)}
        settings={settings}
        onChange={update}
      />
      <SettingsPanel
        open={panel === "settings"}
        onClose={() => setPanel(null)}
        settings={settings}
        onChange={update}
      />
    </section>
  );
}
