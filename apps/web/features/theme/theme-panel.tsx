"use client";

import { Check, Monitor, Moon, Palette, Sun, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import {
  applyTheme,
  DEFAULT_THEME,
  type Mode,
  PRESETS,
  parseChoice,
  THEME_KEY,
  type ThemeChoice,
} from "./theme";

const MODES: Array<{ id: Mode; label: string; icon: typeof Sun }> = [
  { id: "light", label: "Light", icon: Sun },
  { id: "system", label: "System", icon: Monitor },
  { id: "dark", label: "Dark", icon: Moon },
];

function readChoice(): ThemeChoice {
  try {
    return parseChoice(localStorage.getItem(THEME_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

/** Palette button in the top bar, opening a side panel to pick mode and colour preset. */
export function ThemePanel() {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ThemeChoice>(DEFAULT_THEME);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setChoice(readChoice()), []);

  // In System mode, follow the device when it switches between light and dark.
  useEffect(() => {
    if (choice.mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(choice);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  const update = useCallback((next: Partial<ThemeChoice>) => {
    setChoice((prev) => {
      const merged = { ...prev, ...next };
      applyTheme(merged);
      return merged;
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Theme"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-hi/[0.08] hover:text-ink"
      >
        <Palette className="h-[18px] w-[18px]" aria-hidden="true" />
        <span className="sr-only">Theme</span>
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50">
            <button
              type="button"
              aria-label="Close theme panel"
              className="absolute inset-0 cursor-default bg-black/30 backdrop-blur-[2px]"
              onClick={close}
              tabIndex={-1}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="pop absolute inset-y-3 right-3 flex w-[min(26rem,calc(100vw-1.5rem))] flex-col overflow-y-auto rounded-[var(--radius-surface)] p-5 sm:p-6"
            >
              <header className="flex items-start justify-between gap-4">
                <div>
                  <h2 id={titleId} className="text-lg font-semibold">
                    Theme
                  </h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    Light or dark, and the accent colour used for buttons, highlights and charts.
                    Saved on this device.
                  </p>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={close}
                  className="rounded-full p-1.5 text-ink-muted hover:bg-hi/[0.08] hover:text-ink"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                  <span className="sr-only">Close</span>
                </button>
              </header>

              <section className="mt-6">
                <h3 className="text-sm font-medium">Mode</h3>
                <div className="mt-2 grid grid-cols-3 gap-1 rounded-[var(--radius-control)] border border-rule bg-well p-1">
                  {MODES.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={choice.mode === id}
                      onClick={() => update({ mode: id })}
                      className={cn(
                        "flex h-10 items-center justify-center gap-2 rounded-[9px] text-sm transition-colors",
                        choice.mode === id
                          ? "raised font-medium text-ink"
                          : "text-ink-muted hover:text-ink",
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="mt-6">
                <h3 className="text-sm font-medium">Theme presets</h3>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {PRESETS.map((p) => {
                    const active = choice.preset === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => update({ preset: p.id })}
                        className={cn(
                          "relative grid gap-2 rounded-[var(--radius-control)] border p-3 text-left transition-colors",
                          active
                            ? "border-coach bg-coach/10 shadow-[0_0_0_1px_var(--color-coach)]"
                            : "border-rule hover:bg-hi/[0.05]",
                        )}
                      >
                        <span className="flex gap-1" aria-hidden="true">
                          {p.swatches.map((c, i) => (
                            <span
                              // biome-ignore lint/suspicious/noArrayIndexKey: fixed swatch strip
                              key={i}
                              className="h-3 flex-1 rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"
                              style={{ background: c }}
                            />
                          ))}
                        </span>
                        <span className="font-medium">{p.name}</span>
                        <span className="text-xs leading-snug text-ink-muted">{p.description}</span>
                        {active && (
                          <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-coach text-coach-ink">
                            <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="mt-6">
                <h3 className="text-sm font-medium">Preview</h3>
                <ThemePreview />
              </section>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** A miniature dashboard card drawn with the live theme tokens. */
function ThemePreview() {
  const line = "M0 52 L18 46 L34 49 L52 38 L70 41 L88 30 L106 33 L124 20 L142 24 L160 12";
  return (
    <div className="surface mt-2 grid gap-3 rounded-[var(--radius-surface)] p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-ink-muted">Balance</p>
          <p className="figures pop-text text-2xl font-semibold text-ink">$18,421</p>
          <p className="figures text-xs font-medium text-profit">+$842.16</p>
        </div>
        <div className="flex gap-1 text-[11px]">
          {["1D", "1W", "1M"].map((t, i) => (
            <span
              key={t}
              className={cn(
                "rounded-full px-2 py-0.5",
                i === 2 ? "bg-coach/20 text-ink" : "text-ink-faint",
              )}
            >
              {t}
            </span>
          ))}
        </div>
      </div>
      <svg
        viewBox="0 0 160 60"
        className="h-16 w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="tp-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-coach)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--color-coach)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L160 60 L0 60 Z`} fill="url(#tp-fill)" />
        <path d={line} fill="none" stroke="var(--color-coach)" strokeWidth="2.2" />
      </svg>
      <div className="flex items-end gap-1.5" aria-hidden="true">
        {[14, 22, 10, 28, 18, 32, 12, 26].map((h, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative bars
            key={i}
            className={cn("pop-bar w-full rounded-t-[4px]", i % 3 === 2 ? "bg-loss" : "bg-profit")}
            style={{ height: h }}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <span className="rounded-full bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-coach)_70%,white),var(--color-coach))] px-3 py-1 text-xs font-medium text-coach-ink">
          Primary
        </span>
        <span className="rounded-full border border-hi/15 bg-hi/[0.08] px-3 py-1 text-xs text-ink">
          Secondary
        </span>
      </div>
    </div>
  );
}
