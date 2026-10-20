import type { OrderflowWindow } from "@atc/shared";
import type { TableSort } from "./views";

/** Matrix filter of the Order Flow page. */
export type MatrixFilter = "all" | "aligned" | "conflict";

/** The Order Flow page's links (window, sort and matrix filter carried along). Server and client. */
export function orderflowHref(
  q: { window: OrderflowWindow; sort: TableSort; mx: MatrixFilter },
  patch: Record<string, string | undefined> = {},
) {
  const p = new URLSearchParams();
  const merged = {
    w: q.window === "1h" ? undefined : q.window,
    sort: q.sort === "volume" ? undefined : q.sort,
    mx: q.mx === "all" ? undefined : q.mx,
    ...patch,
  };
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
  return `/orderflow?${p}`;
}
