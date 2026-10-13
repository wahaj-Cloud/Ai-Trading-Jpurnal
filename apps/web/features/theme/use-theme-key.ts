"use client";

import { useEffect, useState } from "react";

/**
 * Changes whenever the mode or preset on <html> changes, so components that bake colours into a
 * canvas (the price charts) can redraw with the new theme.
 */
export function useThemeKey(): string {
  const [key, setKey] = useState("");
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setKey(`${root.dataset.mode ?? ""}:${root.dataset.preset ?? ""}`);
    read();
    const obs = new MutationObserver(read);
    obs.observe(root, { attributes: true, attributeFilter: ["data-mode", "data-preset"] });
    return () => obs.disconnect();
  }, []);
  return key;
}
