import { createHash } from "node:crypto";
import type { Impact } from "@atc/shared";
import { z } from "zod";

/** One event in the ForexFactory weekly export (nfs.faireconomy.media ff_calendar_*.json). */
const ffEventSchema = z.object({
  title: z.string().min(1).max(300),
  country: z.string().min(2).max(8),
  date: z.string().min(10).max(40),
  impact: z.string().max(40).optional().default(""),
  forecast: z.string().max(60).optional().nullable(),
  previous: z.string().max(60).optional().nullable(),
  actual: z.string().max(60).optional().nullable(),
});

export interface ParsedEvent {
  id: string;
  title: string;
  currency: string;
  impact: Impact;
  startsAt: Date;
  tentative: boolean;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
}

const IMPACT: Record<string, Impact> = { high: "HIGH", medium: "MEDIUM", low: "LOW" };
const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export const eventId = (source: string, currency: string, title: string, at: Date) =>
  createHash("sha256")
    .update(`${source}|${currency}|${title}|${at.toISOString()}`)
    .digest("hex")
    .slice(0, 40);

/**
 * Validates a weekly export. Malformed rows are skipped rather than failing the batch, but the
 * whole response must be a list with at least one valid event (an HTML "Request denied" page or an
 * empty body never wipes stored data).
 */
export function parseForexFactory(json: unknown, source = "forexfactory"): ParsedEvent[] {
  if (!Array.isArray(json)) throw new Error("Calendar feed is not a list");
  const out: ParsedEvent[] = [];
  for (const raw of json) {
    const r = ffEventSchema.safeParse(raw);
    if (!r.success) continue;
    const at = new Date(r.data.date);
    if (Number.isNaN(at.getTime())) continue;
    const kind = r.data.impact.trim().toLowerCase();
    const currency = r.data.country.trim().toUpperCase();
    out.push({
      id: eventId(source, currency, r.data.title.trim(), at),
      title: r.data.title.trim(),
      currency,
      impact: IMPACT[kind] ?? "NONE",
      startsAt: at,
      // Holidays and "all day" items have no release time.
      tentative: kind === "holiday",
      actual: text(r.data.actual),
      forecast: text(r.data.forecast),
      previous: text(r.data.previous),
    });
  }
  if (out.length === 0) throw new Error("Calendar feed had no valid events");
  return out;
}
