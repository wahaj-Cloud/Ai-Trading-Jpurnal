import { describe, expect, it } from "vitest";
import { BOOT_SCRIPT, DEFAULT_THEME, PRESETS, parseChoice, resolveMode } from "./theme";

describe("theme choice", () => {
  it("falls back to the default for missing or broken values", () => {
    expect(parseChoice(null)).toEqual(DEFAULT_THEME);
    expect(parseChoice("{oops")).toEqual(DEFAULT_THEME);
    expect(parseChoice('{"mode":"neon","preset":"pink"}')).toEqual(DEFAULT_THEME);
  });

  it("keeps valid parts of a stored choice", () => {
    expect(parseChoice('{"mode":"light","preset":"terminal"}')).toEqual({
      mode: "light",
      preset: "terminal",
    });
    expect(parseChoice('{"mode":"system"}')).toEqual({ mode: "system", preset: "wickmentor" });
  });

  it("resolves system mode from the device setting", () => {
    expect(resolveMode("system", true)).toBe("dark");
    expect(resolveMode("system", false)).toBe("light");
    expect(resolveMode("light", true)).toBe("light");
  });

  it("boot script knows every preset", () => {
    for (const p of PRESETS) expect(BOOT_SCRIPT).toContain(`"${p.id}"`);
  });
});
