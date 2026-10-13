"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useState } from "react";

/** Toggles browser full screen, handy for a second trading monitor. */
export function FullscreenButton() {
  const [full, setFull] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(Boolean(document.documentElement.requestFullscreen));
    const onChange = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  if (!supported) return null;
  const Icon = full ? Minimize2 : Maximize2;
  return (
    <button
      type="button"
      onClick={() =>
        full
          ? void document.exitFullscreen()
          : void document.documentElement.requestFullscreen().catch(() => {})
      }
      title={full ? "Exit full screen" : "Full screen"}
      className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-hi/[0.08] hover:text-ink md:flex"
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      <span className="sr-only">{full ? "Exit full screen" : "Full screen"}</span>
    </button>
  );
}
