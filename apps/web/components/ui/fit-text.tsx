"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/cn";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * One line of text that shrinks its font until it fits its box (down to `min` of the original
 * size), then ellipsises. For big amounts in tiles: "+Rs 14,927,529.96" stays whole and readable
 * on a phone instead of being cut off. Re-fits when the box is resized.
 */
export function FitText({
  children,
  className,
  min = 0.6,
}: {
  children: ReactNode;
  className?: string;
  /** Smallest scale allowed, as a share of the CSS font size. */
  min?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const shrinkToFit = () => {
      el.style.fontSize = "";
      const base = Number.parseFloat(getComputedStyle(el).fontSize);
      let size = base;
      while (el.scrollWidth > el.clientWidth + 0.5 && size > base * min) {
        size = Math.max(base * min, size - 1);
        el.style.fontSize = `${size}px`;
      }
    };
    shrinkToFit();
    const ro = new ResizeObserver(shrinkToFit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [children, min]);
  return (
    <span
      ref={ref}
      className={cn("block max-w-full overflow-hidden text-ellipsis whitespace-nowrap", className)}
    >
      {children}
    </span>
  );
}
