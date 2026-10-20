import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * False on the server and while the page hydrates, true once it runs in the browser. Use it for
 * anything that depends on the browser's clock or time zone, so the server HTML and the first
 * browser render always match (no hydration mismatch) and the local value appears right after.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
