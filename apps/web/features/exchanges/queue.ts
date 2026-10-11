import { EXCHANGE_IDS, type ExchangeId, isExchangeId } from "@atc/shared";

/**
 * "Connect several exchanges at once" is a queue carried in the URL, so it survives reloads and
 * needs no server state: /exchanges/connect/kucoin?q=BINANCE,KUCOIN,BINGX&done=BINANCE
 * Every value is re-validated on read, because URLs (and bound action arguments) are user input.
 */
export interface ConnectQueue {
  order: ExchangeId[];
  done: ExchangeId[];
  current: ExchangeId;
}

export function parseIds(value: string | string[] | undefined): ExchangeId[] {
  const raw = (Array.isArray(value) ? value.join(",") : (value ?? "")).split(",");
  const ids = raw.map((s) => s.trim().toUpperCase()).filter(isExchangeId);
  return [...new Set(ids)];
}

export function slugToExchange(slug: string): ExchangeId | null {
  const id = slug.toUpperCase();
  return isExchangeId(id) ? id : null;
}

export function buildQueue(
  current: ExchangeId,
  q?: string | string[],
  done?: string | string[],
): ConnectQueue {
  const order = parseIds(q);
  return {
    order: order.includes(current) ? order : [current],
    done: parseIds(done).filter((id) => id !== current),
    current,
  };
}

/** Canonical order for a set of picked exchanges: the catalog order users see on the picker. */
export function orderPicked(picked: ExchangeId[]): ExchangeId[] {
  return EXCHANGE_IDS.filter((id) => picked.includes(id));
}

export function stepHref(exchange: ExchangeId, order: ExchangeId[], done: ExchangeId[]): string {
  const params = new URLSearchParams();
  if (order.length > 1) params.set("q", order.join(","));
  if (done.length > 0) params.set("done", done.join(","));
  const query = params.toString();
  return `/exchanges/connect/${exchange.toLowerCase()}${query ? `?${query}` : ""}`;
}

export function finishHref(done: ExchangeId[]): string {
  return done.length > 0 ? `/exchanges?connected=${done.join(",")}` : "/exchanges";
}

/** Where to go after the current exchange, whether it was connected or skipped. */
export function afterCurrent(queue: ConnectQueue, connected: boolean): string {
  const done = connected ? [...queue.done, queue.current] : queue.done;
  const next = queue.order[queue.order.indexOf(queue.current) + 1];
  return next ? stepHref(next, queue.order, done) : finishHref(done);
}
