"use client";

import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SidePanel } from "@/components/ui/side-panel";
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
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
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

      <SidePanel
        open={open}
        onClose={close}
        title="Theme"
        description="Light or dark, and the accent colour used for buttons, highlights and charts. Changes apply instantly and are saved on this device."
      >
        <section>
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
      </SidePanel>
    </>
  );
}
