/**
 * Appearance: light/dark/system mode plus an accent preset. The choice lives in this browser
 * (localStorage) and is applied to <html> as data-mode / data-preset before the first paint by
 * BOOT_SCRIPT, so pages never flash the wrong theme.
 */
export type Mode = "light" | "dark" | "system";
export type Preset = "wickmentor" | "quant" | "graphite" | "terminal" | "lavender";

export interface ThemeChoice {
  mode: Mode;
  preset: Preset;
}

export const THEME_KEY = "wm-theme";
export const DEFAULT_THEME: ThemeChoice = { mode: "dark", preset: "wickmentor" };

export interface PresetInfo {
  id: Preset;
  name: string;
  description: string;
  /** Accent, two surfaces, profit, loss: the swatch strip on the preset card. */
  swatches: [string, string, string, string, string];
}

export const PRESETS: readonly PresetInfo[] = [
  {
    id: "wickmentor",
    name: "WickMentor",
    description: "The default blue liquid-glass workspace.",
    swatches: ["#4d94ff", "#0e1640", "#1c2550", "#26b07e", "#e5484d"],
  },
  {
    id: "quant",
    name: "Quant",
    description: "Cyan-teal signal accent over deep sea glass.",
    swatches: ["#1fbfd2", "#0b1d2e", "#14304a", "#26b07e", "#e5484d"],
  },
  {
    id: "graphite",
    name: "Graphite",
    description: "Neutral charcoal with a quiet indigo accent.",
    swatches: ["#818cf8", "#16181f", "#24272f", "#26b07e", "#e5484d"],
  },
  {
    id: "terminal",
    name: "Terminal",
    description: "Amber on black, like a classic market terminal.",
    swatches: ["#f5a524", "#0b0904", "#1e1a10", "#26b07e", "#e5484d"],
  },
  {
    id: "lavender",
    name: "Lavender",
    description: "Soft pastels on deep ink.",
    swatches: ["#b4a2f5", "#171428", "#262040", "#7fd8a6", "#f08ca0"],
  },
];

const MODES: readonly Mode[] = ["light", "dark", "system"];

/** Reads a stored choice, falling back to the default for anything missing or malformed. */
export function parseChoice(raw: string | null | undefined): ThemeChoice {
  if (!raw) return DEFAULT_THEME;
  try {
    const v = JSON.parse(raw) as Partial<ThemeChoice>;
    return {
      mode: MODES.includes(v.mode as Mode) ? (v.mode as Mode) : DEFAULT_THEME.mode,
      preset: PRESETS.some((p) => p.id === v.preset) ? (v.preset as Preset) : DEFAULT_THEME.preset,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export function resolveMode(mode: Mode, prefersDark: boolean): "light" | "dark" {
  return mode === "system" ? (prefersDark ? "dark" : "light") : mode;
}

/** Applies a choice to <html> and remembers it. Browser only. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.mode = resolveMode(choice.mode, dark);
  root.dataset.preset = choice.preset;
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify(choice));
  } catch {
    // Private mode or storage blocked: the theme still applies for this visit.
  }
}

/** Inline <head> script: same logic as parseChoice/resolveMode, run before the page paints. */
export const BOOT_SCRIPT = `(function(){try{var d=document.documentElement,c={};try{c=JSON.parse(localStorage.getItem("${THEME_KEY}")||"{}")||{}}catch(e){}var m=c.mode;if(m!=="light"&&m!=="dark"&&m!=="system")m="dark";if(m==="system")m=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.dataset.mode=m;var p=["wickmentor","quant","graphite","terminal","lavender"];d.dataset.preset=p.indexOf(c.preset)>-1?c.preset:"wickmentor"}catch(e){}})();`;
