"use client";

import { type FlowStrength, REGIME_INFO, type Regime, STRENGTH_LABEL } from "@atc/shared";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { coinName, pct, usd } from "./format";

/** The lean per-coin data the visual needs (series downsampled by the worker). */
export interface GateCoin {
  symbol: string;
  rank: number;
  volumeUsd: number;
  netFlowUsd: number;
  buyPressurePct: number;
  priceChangePct: number;
  regime: Regime;
  strength: FlowStrength;
  pressure: number[];
}

interface Props {
  coins: GateCoin[];
  buying: number;
  selling: number;
  window: string;
  asOf: string | null;
  mine: string[];
  /** Base address for a coin's detail (…&c=SYMBOL). */
  detailHref: string;
}

const TOP = 12;
const MAX_LINES = 70;

interface Colors {
  ink: string;
  muted: string;
  faint: string;
  rule: string;
  up: string;
  down: string;
  accent: string;
  card: string;
}
function readColors(el: Element): Colors {
  const cs = getComputedStyle(el);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  const dark = document.documentElement.dataset.mode !== "light";
  return {
    ink: v("--color-ink", "#f2f5ff"),
    muted: v("--color-ink-muted", "#aab6d6"),
    faint: v("--color-ink-faint", "#7d8bb3"),
    rule: v("--color-rule", "rgba(255,255,255,.12)"),
    up: v("--pnl-profit", "#22c55e"),
    down: v("--pnl-loss", "#ef4444"),
    accent: v("--color-coach", "#4d94ff"),
    card: dark ? "rgba(10,14,40,0.88)" : "rgba(255,255,255,0.92)",
  };
}

/** Converts any CSS colour to rgba with the given alpha (canvas-safe). */
function alpha(color: string, a: number, ctx: CanvasRenderingContext2D): string {
  ctx.fillStyle = color;
  const c = ctx.fillStyle; // normalised: #rrggbb or rgba(...)
  if (c.startsWith("#")) {
    const n = Number.parseInt(c.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m?.[1]) return color;
  const [r, g, b] = m[1].split(",").map((x) => x.trim());
  return `rgba(${r},${g},${b},${a})`;
}

interface Pt {
  x: number;
  y: number;
}
type Curve = [Pt, Pt, Pt, Pt];
const bez = ([a, b, c, d]: Curve, t: number): Pt => {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
};
const sCurve = (a: Pt, d: Pt): Curve => {
  const mx = (a.x + d.x) / 2;
  return [a, { x: mx, y: a.y }, { x: mx, y: d.y }, d];
};

interface Layout {
  W: number;
  H: number;
  wide: boolean;
  plot: { x0: number; x1: number; top: number; bottom: number; mid: number; scale: number };
  nowX: number;
  gate: { x: number; w: number; h: number; buyY: number; sellY: number };
  cards: { x: number; w: number; h: number; gap: number } | null;
  lines: Array<{ coin: GateCoin; pts: Pt[]; end: Pt; toGate: Curve }>;
  ribbons: Array<{ coin: GateCoin; curve: Curve; width: number; card: DOMRectLike }>;
  maxAbs: number;
}
interface DOMRectLike {
  x: number;
  y: number;
  w: number;
  h: number;
}

function layout(W: number, props: Props, buyTop: GateCoin[], sellTop: GateCoin[]): Layout {
  const wide = W >= 760;
  const H = wide ? 660 : 420;
  const top = 46;
  const bottom = H - 30;
  const mid = (top + bottom) / 2;
  const x0 = 44;
  const nowX = wide ? W * 0.43 : W * 0.6;
  const gw = wide ? 112 : 74;
  const gh = wide ? 74 : 60;
  const gx = wide ? W * 0.565 : W - gw / 2 - 10;
  const buyY = wide ? H * 0.27 : H * 0.3;
  const sellY = wide ? H * 0.73 : H * 0.7;
  // Vertical scale: most lines fit; extreme ones are clipped at the edge.
  // The first few candles of a cumulative ratio swing wildly (one candle can be ±40%), so each
  // line starts once a tenth of the period has traded; the scale covers 95% of what is drawn.
  const skip = (len: number) => Math.max(1, Math.floor(len * 0.1));
  const drawn = props.coins
    .flatMap((c) => c.pressure.slice(skip(c.pressure.length)))
    .map(Math.abs)
    .sort((a, b) => a - b);
  const p95 = drawn[Math.floor((drawn.length - 1) * 0.95)] ?? 5;
  const maxAbs = Math.min(60, Math.max(4, 2 * Math.ceil((p95 * 1.15) / 2)));
  const scale = (bottom - top) / 2 / maxAbs;
  const plotX1 = nowX - 6;
  const yOf = (v: number) => mid - Math.max(-maxAbs, Math.min(maxAbs, v)) * scale;

  const shown = [...props.coins].sort((a, b) => a.rank - b.rank).slice(0, MAX_LINES);
  const lines = shown.map((coin) => {
    const s = coin.pressure.length ? coin.pressure : [coin.buyPressurePct];
    const n = Math.max(1, s.length - 1);
    const from = s.length > 2 ? skip(s.length) : 0;
    const pts = s.map((v, i) => ({ x: x0 + ((plotX1 - x0) * i) / n, y: yOf(v) })).slice(from);
    const end = { x: nowX, y: pts.at(-1)?.y ?? mid };
    const gy = coin.netFlowUsd >= 0 ? buyY : sellY;
    // Lines fan into the gate's left edge, spread over its height.
    const spread = ((end.y - mid) / (bottom - top)) * gh * 0.8;
    const toGate = sCurve(end, { x: gx - gw / 2, y: gy + spread });
    return { coin, pts, end, toGate };
  });

  let cards: Layout["cards"] = null;
  const ribbons: Layout["ribbons"] = [];
  if (wide) {
    const cx = W * 0.7;
    const cw = W - cx - 12;
    const gap = 4;
    const area = (bottom - top - 24) / 2;
    const ch = Math.min(30, (area - gap * (TOP - 1)) / TOP);
    cards = { x: cx, w: cw, h: ch, gap };
    const maxUsd = Math.max(1, ...[...buyTop, ...sellTop].map((c) => Math.abs(c.netFlowUsd)));
    const place = (list: GateCoin[], y0: number, gy: number) =>
      list.forEach((coin, i) => {
        const card = { x: cx, y: y0 + i * (ch + gap), w: cw, h: ch };
        ribbons.push({
          coin,
          card,
          width: 1 + 5 * Math.sqrt(Math.abs(coin.netFlowUsd) / maxUsd),
          curve: sCurve({ x: gx + gw / 2, y: gy }, { x: cx, y: card.y + ch / 2 }),
        });
      });
    place(buyTop, top, buyY);
    place(sellTop, bottom - TOP * (ch + gap) + gap, sellY);
  }
  return {
    W,
    H,
    wide,
    plot: { x0, x1: plotX1, top, bottom, mid, scale },
    nowX,
    gate: { x: gx, w: gw, h: gh, buyY, sellY },
    cards,
    lines,
    ribbons,
    maxAbs,
  };
}

function tracePts(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  for (const [i, p] of pts.entries()) {
    if (i) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, r: DOMRectLike, radius: number) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
}

/**
 * Order flow "two gates": each line on the left is one coin's cumulative taker buy pressure over
 * the window (real 5-minute data); at NOW every coin goes through the gate of the side that
 * dominated (net buying above, net selling below), and the largest twelve on each side fan out to
 * cards with their dollar flow. Moving dots show direction only; their speed follows each coin's
 * buy pressure. Hover a card for figures, click it for the coin's detail.
 */
export function OrderflowGates(props: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const router = useRouter();
  const [width, setWidth] = useState(0);
  const [hoverRaw, setHover] = useState<GateCoin | null>(null);
  // Figures update every second on live pages: the tooltip shows the hovered coin's latest ones.
  const hover = hoverRaw
    ? (props.coins.find((c) => c.symbol === hoverRaw.symbol) ?? hoverRaw)
    : null;
  /** The dots' clock survives data updates, so they keep moving instead of jumping back. */
  const clock = useRef(0);
  const [tip, setTip] = useState<Pt | null>(null);
  const mine = useMemo(() => new Set(props.mine), [props.mine]);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  /** Without animation the picture is redrawn only when the hovered coin changes. */
  const staticHover = reduced ? hover : null;

  const buyTop = useMemo(
    () =>
      props.coins
        .filter((c) => c.netFlowUsd > 0)
        .sort((a, b) => b.netFlowUsd - a.netFlowUsd)
        .slice(0, TOP),
    [props.coins],
  );
  const sellTop = useMemo(
    () =>
      props.coins
        .filter((c) => c.netFlowUsd < 0)
        .sort((a, b) => a.netFlowUsd - b.netFlowUsd)
        .slice(0, TOP),
    [props.coins],
  );
  const L = useMemo(
    () => (width > 0 ? layout(width, props, buyTop, sellTop) : null),
    [width, props, buyTop, sellTop],
  );

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drawing: a static layer (lines, gates, cards) redrawn on change, plus moving dots.
  const hoverRef = useRef<GateCoin | null>(null);
  hoverRef.current = hover;
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !L) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // Resizing a canvas clears it: only when the size really changed.
    if (cv.width !== Math.round(L.W * dpr)) cv.width = Math.round(L.W * dpr);
    if (cv.height !== Math.round(L.H * dpr)) cv.height = Math.round(L.H * dpr);
    cv.style.height = `${L.H}px`;
    let colors = readColors(cv);
    const mo = new MutationObserver(() => {
      colors = readColors(cv);
    });
    mo.observe(document.documentElement, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-mode", "data-pnl", "data-preset"],
    });
    let visible = true;
    const io = new IntersectionObserver(([e]) => {
      visible = e?.isIntersecting ?? true;
    });
    io.observe(cv);

    const side = (c: GateCoin) => (c.netFlowUsd >= 0 ? colors.up : colors.down);
    // Dots: a few per line, phase offset by rank so they never march in step.
    const paths = [
      ...L.lines.map((l) => ({ coin: l.coin, curve: l.toGate, lane: 0 })),
      ...L.ribbons.map((r) => ({ coin: r.coin, curve: r.curve, lane: 1 })),
    ];

    const drawStatic = () => {
      const h = hoverRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, L.W, L.H);
      ctx.font = "500 11px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      const { x0, x1, top, bottom, mid, scale } = L.plot;

      // Grid: zero line and ± guides.
      ctx.strokeStyle = colors.rule;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      for (const g of [-L.maxAbs / 2, L.maxAbs / 2]) {
        ctx.beginPath();
        ctx.moveTo(x0, mid - g * scale);
        ctx.lineTo(x1, mid - g * scale);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = alpha(colors.muted, 0.5, ctx);
      ctx.beginPath();
      ctx.moveTo(x0, mid);
      ctx.lineTo(x1, mid);
      ctx.stroke();
      ctx.fillStyle = colors.faint;
      ctx.textAlign = "right";
      ctx.fillText(`+${L.maxAbs / 2}%`, x0 - 6, mid - (L.maxAbs / 2) * scale);
      ctx.fillText("0", x0 - 6, mid);
      ctx.fillText(`−${L.maxAbs / 2}%`, x0 - 6, mid + (L.maxAbs / 2) * scale);
      ctx.textAlign = "left";
      ctx.fillStyle = colors.muted;
      ctx.fillText(
        L.wide ? `Buy pressure · ${props.window} ago → now` : "Buy pressure",
        x0,
        top - 22,
      );
      ctx.fillStyle = colors.faint;
      ctx.fillText("more buying ↑", x0, top - 6);
      ctx.fillText("more selling ↓", x0, bottom + 14);

      // Coin lines, faint, then the hovered one on top.
      const maxVol = Math.max(1, ...L.lines.map((l) => l.coin.volumeUsd));
      for (const l of L.lines) {
        const isH = h?.symbol === l.coin.symbol;
        if (isH) continue;
        const w = Math.sqrt(l.coin.volumeUsd / maxVol);
        ctx.strokeStyle = alpha(side(l.coin), h ? 0.08 : 0.18 + 0.5 * w, ctx);
        ctx.lineWidth = mine.has(l.coin.symbol) ? 2.2 : 0.8 + 1.2 * w;
        ctx.beginPath();
        tracePts(ctx, l.pts);
        const [a, b, c, d] = l.toGate;
        ctx.lineTo(a.x, a.y);
        ctx.bezierCurveTo(b.x, b.y, c.x, c.y, d.x, d.y);
        ctx.stroke();
      }

      // NOW gate.
      ctx.fillStyle = alpha(colors.accent, 0.16, ctx);
      roundRect(ctx, { x: L.nowX - 5, y: top - 4, w: 10, h: bottom - top + 8 }, 5);
      ctx.fill();
      ctx.strokeStyle = alpha(colors.accent, 0.8, ctx);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = colors.accent;
      ctx.textAlign = "center";
      ctx.font = "700 11px system-ui, sans-serif";
      ctx.fillText("NOW", L.nowX, top - 14);

      // Ribbons to the cards.
      for (const r of L.ribbons) {
        const isH = h?.symbol === r.coin.symbol;
        ctx.strokeStyle = alpha(side(r.coin), isH ? 0.95 : h ? 0.12 : 0.38, ctx);
        ctx.lineWidth = r.width + (isH ? 1 : 0);
        const [a, b, c, d] = r.curve;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.bezierCurveTo(b.x, b.y, c.x, c.y, d.x, d.y);
        ctx.stroke();
      }

      // Gates.
      const gate = (y: number, label: string, count: number, color: string) => {
        const r = { x: L.gate.x - L.gate.w / 2, y: y - L.gate.h / 2, w: L.gate.w, h: L.gate.h };
        ctx.fillStyle = colors.card;
        roundRect(ctx, r, 12);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.shadowColor = alpha(color, 0.6, ctx);
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.textAlign = "center";
        ctx.fillStyle = color;
        ctx.font = `700 ${L.wide ? 26 : 20}px system-ui, sans-serif`;
        ctx.fillText(String(count), L.gate.x, y - 7);
        ctx.font = `600 ${L.wide ? 11 : 10}px system-ui, sans-serif`;
        ctx.fillStyle = colors.muted;
        ctx.fillText(label, L.gate.x, y + (L.wide ? 20 : 16));
      };
      gate(L.gate.buyY, L.wide ? "NET BUYING" : "BUYING", props.buying, colors.up);
      gate(L.gate.sellY, L.wide ? "NET SELLING" : "SELLING", props.selling, colors.down);

      // Cards.
      if (L.cards) {
        ctx.textAlign = "left";
        ctx.font = "600 10px system-ui, sans-serif";
        ctx.fillStyle = colors.faint;
        ctx.fillText(`MOST BOUGHT · TOP ${TOP}`, L.cards.x, L.plot.top - 14);
        const lastSell = L.ribbons.filter((r) => r.coin.netFlowUsd < 0)[0];
        if (lastSell) ctx.fillText(`MOST SOLD · TOP ${TOP}`, L.cards.x, lastSell.card.y - 12);
        for (const r of L.ribbons) {
          const c = r.coin;
          const isH = h?.symbol === c.symbol;
          const col = side(c);
          ctx.fillStyle = colors.card;
          roundRect(ctx, r.card, 7);
          ctx.fill();
          ctx.strokeStyle = alpha(col, isH ? 1 : 0.55, ctx);
          ctx.lineWidth = isH ? 2 : 1;
          ctx.stroke();
          const cy = r.card.y + r.card.h / 2;
          ctx.font = "700 12px system-ui, sans-serif";
          ctx.fillStyle = colors.ink;
          ctx.textAlign = "left";
          const name = coinName(c.symbol);
          ctx.fillText(name, r.card.x + 9, cy);
          const nameW = ctx.measureText(name).width;
          if (mine.has(c.symbol)) {
            ctx.fillStyle = colors.accent;
            ctx.beginPath();
            ctx.arc(r.card.x + 15 + nameW, cy, 3, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.font = "500 10.5px system-ui, sans-serif";
          ctx.fillStyle = colors.faint;
          if (r.card.w > 230)
            ctx.fillText(
              c.regime === "neutral"
                ? `buy pressure ${pct(c.buyPressurePct, 1)}`
                : REGIME_INFO[c.regime].label,
              r.card.x + 24 + nameW,
              cy,
            );
          ctx.textAlign = "right";
          ctx.font = "700 12px system-ui, sans-serif";
          ctx.fillStyle = col;
          ctx.fillText(usd(c.netFlowUsd, 1), r.card.x + r.card.w - 9, cy);
        }
      }

      // Hovered coin's line, on top.
      const hl = h && L.lines.find((l) => l.coin.symbol === h.symbol);
      if (hl) {
        ctx.strokeStyle = side(hl.coin);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        tracePts(ctx, hl.pts);
        const [a, b, c, d] = hl.toGate;
        ctx.lineTo(a.x, a.y);
        ctx.bezierCurveTo(b.x, b.y, c.x, c.y, d.x, d.y);
        ctx.stroke();
        ctx.fillStyle = side(hl.coin);
        ctx.beginPath();
        ctx.arc(hl.end.x, hl.end.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    let raf = 0;
    if (!clock.current) clock.current = performance.now();
    const start = clock.current;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      drawStatic();
      const h = hoverRef.current;
      const t = (now - start) / 1000;
      for (const [i, p] of paths.entries()) {
        if (h && h.symbol !== p.coin.symbol) continue;
        // Speed follows buy pressure strength (0.12–0.5 laps per second).
        const speed = 0.12 + Math.min(0.38, Math.abs(p.coin.buyPressurePct) / 60);
        const dots = p.lane ? 3 : 1;
        for (let k = 0; k < dots; k++) {
          const u = (t * speed + i * 0.137 + k / dots) % 1;
          const pt = bez(p.curve, u);
          ctx.fillStyle = alpha(side(p.coin), p.lane ? 0.95 : 0.7, ctx);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, p.lane ? 2.2 : 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    if (reduced) {
      hoverRef.current = staticHover;
      drawStatic();
    } else raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      io.disconnect();
    };
  }, [L, props.window, props.buying, props.selling, mine, reduced, staticHover]);

  const hitTest = (e: React.MouseEvent<HTMLCanvasElement>): GateCoin | null => {
    if (!L) return null;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    for (const rb of L.ribbons) {
      const c = rb.card;
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return rb.coin;
    }
    // Near a line's end at NOW, or along its left part.
    if (x >= L.plot.x0 && x <= L.nowX + 8) {
      let best: { coin: GateCoin; d: number } | null = null;
      for (const l of L.lines) {
        let p: Pt | undefined = x > L.plot.x1 ? l.end : undefined;
        if (!p) for (const q of l.pts) if (!p || Math.abs(q.x - x) < Math.abs(p.x - x)) p = q;
        if (p && Math.abs(p.x - x) > 12) p = undefined;
        if (!p) continue;
        const d = Math.abs(p.y - y);
        if (d < 6 && (!best || d < best.d)) best = { coin: l.coin, d };
      }
      return best?.coin ?? null;
    }
    return null;
  };

  const narrowLists = L && !L.wide;
  return (
    <div className="grid gap-4">
      <div ref={wrap} className="relative w-full">
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Order flow over the last ${props.window}: ${props.buying} coins with net buying, ${props.selling} with net selling.`}
          className={cn("block w-full", hover && "cursor-pointer")}
          style={{ height: L?.H ?? 420 }}
          onMouseMove={(e) => {
            const c = hitTest(e);
            setHover(c);
            const r = e.currentTarget.getBoundingClientRect();
            setTip(c ? { x: e.clientX - r.left, y: e.clientY - r.top } : null);
          }}
          onMouseLeave={() => {
            setHover(null);
            setTip(null);
          }}
          onClick={() => {
            if (hover) router.push(`${props.detailHref}&c=${hover.symbol}#coin`);
          }}
        />
        {hover && tip && L && (
          <div
            className="pointer-events-none absolute z-10 w-56 rounded-[var(--radius-control)] border border-rule bg-[var(--color-sheet)] p-3 text-xs shadow-lg"
            style={{
              left: Math.min(L.W - 232, tip.x + 14),
              top: Math.min(L.H - 130, Math.max(0, tip.y - 10)),
            }}
          >
            <p className="mb-1 font-semibold text-ink">
              {coinName(hover.symbol)}{" "}
              <span className="font-normal text-ink-faint">#{hover.rank} by volume</span>
            </p>
            <p className="text-ink-muted">{REGIME_INFO[hover.regime].label}</p>
            <dl className="figures mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5">
              <dt className="text-ink-faint">Net taker</dt>
              <dd className={hover.netFlowUsd >= 0 ? "text-profit" : "text-loss"}>
                {usd(hover.netFlowUsd, 1)}
              </dd>
              <dt className="text-ink-faint">Buy pressure</dt>
              <dd>
                {pct(hover.buyPressurePct, 1)} · {STRENGTH_LABEL[hover.strength]}
              </dd>
              <dt className="text-ink-faint">Price</dt>
              <dd>{pct(hover.priceChangePct, 1)}</dd>
            </dl>
            <p className="mt-2 text-ink-faint">Click for detail</p>
          </div>
        )}
      </div>
      {narrowLists && (
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { title: `Most bought · top ${TOP}`, list: buyTop },
            { title: `Most sold · top ${TOP}`, list: sellTop },
          ].map(({ title, list }) => (
            <div key={title}>
              <p className="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">
                {title}
              </p>
              <ul className="grid gap-1.5">
                {list.map((c) => (
                  <li key={c.symbol}>
                    <a
                      href={`${props.detailHref}&c=${c.symbol}#coin`}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-[var(--radius-control)] border px-3 py-1.5 text-sm",
                        c.netFlowUsd >= 0 ? "border-profit/40" : "border-loss/40",
                      )}
                    >
                      <span className="font-semibold">
                        {coinName(c.symbol)}
                        {mine.has(c.symbol) && (
                          <span className="ml-1.5 text-xs text-coach">● yours</span>
                        )}
                        <span className="ml-2 text-xs font-normal text-ink-faint">
                          {c.regime === "neutral"
                            ? `buy pressure ${pct(c.buyPressurePct, 1)}`
                            : REGIME_INFO[c.regime].label}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "figures font-semibold",
                          c.netFlowUsd >= 0 ? "text-profit" : "text-loss",
                        )}
                      >
                        {usd(c.netFlowUsd, 1)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
