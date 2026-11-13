"use client";

import { type Breadth, medianPath, type Sector, sectorOf } from "@atc/shared";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { coinName, pct } from "./format";
import { alpha, type Colors, readColors } from "./gates";

export interface RiverCoin {
  symbol: string;
  rank: number;
  volumeUsd: number;
  /** The move at the point shown (now, or the replay point). */
  priceChangePct: number;
  /** % from the window start, oldest first, ending now (see `riverPath`). */
  path: number[];
}

const GOLD = "#e9b949";
const SILVER = "#c9d1dc";
const METALS: Record<string, string> = { XAUUSDT: GOLD, XAGUSDT: SILVER };

interface Hover {
  symbol: string;
  x: number;
  y: number;
  pct: number;
}

/**
 * The market river: every coin's move since the window started, one thin line each (green ending
 * up, red ending down), the market's middle path in blue, gold and silver always marked, and a
 * strip of dots at the top placing every coin by its move now. Hover a line for its figures;
 * click to open the coin.
 */
export function MarketRiver({
  coins,
  breadth,
  window: label,
  coinHref,
  selected,
  highlight,
  at = null,
  atLabel,
}: {
  coins: RiverCoin[];
  breadth: Breadth;
  window: string;
  coinHref: (symbol: string) => string;
  selected: string | null;
  /** A sector to bring forward (others fade). */
  highlight: Sector | null;
  /** Replay point: index on the aligned paths (null = now). */
  at?: number | null;
  /** The replay point's time, for the cursor. */
  atLabel?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const router = useRouter();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<Hover | null>(null);
  const paths = coins;
  const mid = useMemo(() => medianPath(paths.map((p) => p.path)), [paths]);

  // Layout: strip on top, river below, price labels on the right.
  const STRIP = 54;
  const RIGHT = 54;
  const PAD = 10;
  const geo = useMemo(() => {
    const len = Math.max(2, ...paths.map((p) => p.path.length));
    const vals = paths.flatMap((p) => p.path).sort((a, b) => a - b);
    // Robust range: the 1st to 99th percentile, so one wild coin cannot flatten the rest.
    const q = (f: number) =>
      vals[Math.min(vals.length - 1, Math.max(0, Math.floor(f * vals.length)))] ?? 0;
    let lo = Math.min(q(0.01), -0.2);
    let hi = Math.max(q(0.99), 0.2);
    const pad = (hi - lo) * 0.06;
    lo -= pad;
    hi += pad;
    const plotW = Math.max(10, size.w - RIGHT - PAD);
    const top = STRIP + 12;
    const plotH = Math.max(10, size.h - top - 22);
    const x = (k: number, n: number) => PAD + ((k + (len - n)) / (len - 1)) * plotW;
    const y = (v: number) => top + ((hi - Math.min(hi, Math.max(lo, v))) / (hi - lo)) * plotH;
    const nowPct = paths.map((p) => p.priceChangePct).sort((a, b) => a - b);
    const sLo = Math.min(nowPct[0] ?? -1, -0.2);
    const sHi = Math.max(nowPct.at(-1) ?? 1, 0.2);
    const sx = (v: number) => PAD + ((v - sLo) / (sHi - sLo)) * plotW;
    return { len, lo, hi, x, y, top, plotW, plotH, sx, sLo, sHi };
  }, [paths, size]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth, h: el.clientWidth < 640 ? 300 : 380 }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr;
    cv.height = size.h * dpr;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const col: Colors = readColors(cv);
    const { x, y, lo, hi, top, plotW, plotH, sx } = geo;

    // Grid: zero line and round % levels.
    ctx.font = "10px ui-monospace, monospace";
    const step = niceStep((hi - lo) / 5);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const yy = y(v);
      ctx.strokeStyle = alpha(col.rule, Math.abs(v) < 1e-9 ? 0.9 : 0.35, ctx);
      ctx.lineWidth = Math.abs(v) < 1e-9 ? 1.2 : 1;
      ctx.setLineDash(Math.abs(v) < 1e-9 ? [] : [3, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD, yy);
      ctx.lineTo(PAD + plotW, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col.faint;
      ctx.fillText(
        `${v > 0 ? "+" : ""}${v.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}%`,
        PAD + plotW + 6,
        yy + 3,
      );
    }
    // Red and green tint either side of zero.
    const zy = y(0);
    const g1 = ctx.createLinearGradient(0, top, 0, zy);
    g1.addColorStop(0, alpha(col.up, 0.1, ctx));
    g1.addColorStop(1, alpha(col.up, 0, ctx));
    ctx.fillStyle = g1;
    ctx.fillRect(PAD, top, plotW, Math.max(0, zy - top));
    const g2 = ctx.createLinearGradient(0, zy, 0, top + plotH);
    g2.addColorStop(0, alpha(col.down, 0, ctx));
    g2.addColorStop(1, alpha(col.down, 0.1, ctx));
    ctx.fillStyle = g2;
    ctx.fillRect(PAD, zy, plotW, Math.max(0, top + plotH - zy));

    const line = (p: number[], color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const [k, v] of p.entries()) {
        if (k === 0) ctx.moveTo(x(k, p.length), y(v));
        else ctx.lineTo(x(k, p.length), y(v));
      }
      ctx.stroke();
    };
    // Every coin, quietest first so big coins sit on top.
    const order = [...paths].sort((a, b) => a.volumeUsd - b.volumeUsd);
    const maxVol = Math.max(1, ...paths.map((p) => p.volumeUsd));
    for (const c of order) {
      if (METALS[c.symbol] || c.symbol === selected) continue;
      const faded = highlight !== null && sectorOf(c.symbol) !== highlight;
      const strong = 0.18 + 0.5 * Math.sqrt(c.volumeUsd / maxVol);
      line(c.path, alpha(c.priceChangePct >= 0 ? col.up : col.down, faded ? 0.06 : strong, ctx), 1);
    }
    // The market's middle path.
    line(mid, alpha(col.accent, 0.95, ctx), 2.2);
    // Gold, silver and the chosen coin, labelled at their ends.
    const cursor = at === null ? geo.len - 1 : at;
    const tag = (c: (typeof paths)[number], color: string) => {
      const n = c.path.length;
      const k = Math.min(n - 1, Math.max(0, cursor - (geo.len - n)));
      const xx = x(k, n);
      const yy = y(c.path[k] ?? 0);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(xx, yy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "600 11px system-ui, sans-serif";
      const t = `${coinName(c.symbol)} ${pct(c.priceChangePct)}`;
      const w = ctx.measureText(t).width;
      ctx.fillText(t, Math.max(PAD, Math.min(PAD + plotW - w, xx - w - 8)), yy - 6);
    };
    for (const c of paths)
      if (METALS[c.symbol] && c.symbol !== selected) {
        line(c.path, METALS[c.symbol] as string, 2);
        tag(c, METALS[c.symbol] as string);
      }
    const sel = paths.find((p) => p.symbol === selected);
    if (sel) {
      line(sel.path, col.ink, 2.6);
      tag(sel, col.ink);
    }

    // Replay: shade what came after the point shown, and mark it.
    if (at !== null) {
      const cx = x(at, geo.len);
      ctx.fillStyle = alpha(col.card, 0.72, ctx);
      ctx.fillRect(cx, top, PAD + plotW - cx, plotH);
      ctx.strokeStyle = alpha(col.accent, 0.9, ctx);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, top - 4);
      ctx.lineTo(cx, top + plotH);
      ctx.stroke();
      if (atLabel) {
        ctx.font = "600 10px ui-monospace, monospace";
        const w = ctx.measureText(atLabel).width;
        const lx = Math.max(PAD, Math.min(PAD + plotW - w - 6, cx - w / 2 - 3));
        ctx.fillStyle = col.accent;
        ctx.fillRect(lx, top + plotH + 2, w + 6, 14);
        ctx.fillStyle = col.card;
        ctx.fillText(atLabel, lx + 3, top + plotH + 12);
      }
    }

    // The strip: every coin placed by its move at the point shown, dot size by traded value.
    ctx.fillStyle = alpha(col.rule, 0.6, ctx);
    ctx.fillRect(PAD, STRIP / 2, plotW, 1);
    const zx = sx(0);
    ctx.fillRect(zx, 6, 1, STRIP - 12);
    const bins = new Map<number, number>();
    const byMove = [...paths].sort((a, b) => b.volumeUsd - a.volumeUsd);
    for (const c of byMove) {
      const px = sx(c.priceChangePct);
      const bin = Math.round(px / 7);
      const n = bins.get(bin) ?? 0;
      bins.set(bin, n + 1);
      const r = 2 + 3.5 * Math.sqrt(c.volumeUsd / maxVol);
      const py = STRIP / 2 + (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 6;
      ctx.fillStyle =
        METALS[c.symbol] ?? alpha(c.priceChangePct >= 0 ? col.up : col.down, 0.85, ctx);
      ctx.beginPath();
      ctx.arc(px, Math.max(6, Math.min(STRIP - 6, py)), r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = col.faint;
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(pct(geo.sLo, 1), PAD, STRIP - 2);
    const hiText = pct(geo.sHi, 1);
    ctx.fillText(hiText, PAD + plotW - ctx.measureText(hiText).width, STRIP - 2);

    // Time labels.
    ctx.fillStyle = col.faint;
    ctx.fillText(`${label} ago`, PAD, size.h - 6);
    ctx.fillText("now", PAD + plotW - 18, size.h - 6);
  }, [paths, mid, geo, size, selected, highlight, label, at, atLabel]);

  const pick = (mx: number, my: number): Hover | null => {
    const { x, y } = geo;
    let best: Hover | null = null;
    let bestD = 14;
    for (const c of paths) {
      const n = c.path.length;
      // Nearest point of this path to the pointer horizontally.
      const k = Math.round(((mx - PAD) / Math.max(1, geo.plotW)) * (geo.len - 1)) - (geo.len - n);
      if (k < 0 || k >= n) continue;
      const v = c.path[k] as number;
      const d = Math.abs(y(v) - my);
      if (d < bestD) {
        bestD = d;
        best = { symbol: c.symbol, x: x(k, n), y: y(v), pct: c.priceChangePct };
      }
    }
    if (my < STRIP) {
      for (const c of paths) {
        const d = Math.abs(geo.sx(c.priceChangePct) - mx);
        if (d < bestD) {
          bestD = d;
          best = {
            symbol: c.symbol,
            x: geo.sx(c.priceChangePct),
            y: STRIP / 2,
            pct: c.priceChangePct,
          };
        }
      }
    }
    return best;
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-xs text-ink-faint">
          Every coin&apos;s move over the last {label}. Blue is the middle coin;{" "}
          <span style={{ color: GOLD }}>gold</span> and{" "}
          <span style={{ color: SILVER }}>silver</span> are always marked.
        </p>
        <dl className="figures flex items-end gap-5 text-right">
          <div>
            <dt className="text-[10px] tracking-wider text-ink-faint uppercase">Up</dt>
            <dd className="text-2xl font-semibold text-profit">{breadth.up}</dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-wider text-ink-faint uppercase">Down</dt>
            <dd className="text-2xl font-semibold text-loss">{breadth.down}</dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-wider text-ink-faint uppercase">Middle coin</dt>
            <dd className="text-sm">{pct(breadth.medianPct)}</dd>
          </div>
        </dl>
      </div>
      <div ref={wrap} className="relative w-full">
        <canvas
          ref={canvas}
          role="img"
          aria-label={`${breadth.up} coins up and ${breadth.down} down over the last ${label}; the middle coin ${pct(breadth.medianPct)}.`}
          style={{ width: "100%", height: size.h || 300 }}
          className="block cursor-crosshair"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setHover(pick(e.clientX - r.left, e.clientY - r.top));
          }}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const h = pick(e.clientX - r.left, e.clientY - r.top);
            if (h) router.push(coinHref(h.symbol), { scroll: false });
          }}
        />
        {hover && (
          <div
            className="pointer-events-none absolute z-10 rounded-[var(--radius-control)] border border-rule bg-[var(--color-sheet)] px-2.5 py-1.5 text-xs shadow-lg"
            style={{
              left: Math.min(hover.x + 10, (size.w || 300) - 150),
              top: Math.max(0, hover.y - 34),
            }}
          >
            <span className="font-semibold">{coinName(hover.symbol)}</span>{" "}
            <span className={hover.pct >= 0 ? "text-profit" : "text-loss"}>{pct(hover.pct)}</span>
            <span className="ml-1 text-ink-faint">· click for its card</span>
          </div>
        )}
      </div>
    </div>
  );
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-6)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}
