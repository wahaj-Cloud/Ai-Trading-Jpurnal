import { z } from "zod";

/**
 * Supply and demand zones on the 1H and 4H timeframes, kept by the worker for every scanned market
 * (top 100 futures, gold and silver) and used by zone alerts, the Scalp Cockpit's levels ladder and
 * the record of where trades were entered. Zones are found with @atc/ta `supplyDemandZones` on each
 * timeframe's own closed candles. A zone records where price reacted; it is not a signal.
 */

export const ZONES_KEY = "zones:latest";
export const ZONE_TFS = ["1h", "4h"] as const;
export type ZoneTf = (typeof ZONE_TFS)[number];
export const ZONE_TF_LABEL: Record<ZoneTf, string> = { "1h": "1H", "4h": "4H" };
export const ZONE_STEP_MS: Record<ZoneTf, number> = { "1h": 3_600_000, "4h": 14_400_000 };
/** Zone records kept for stamping trades. */
export const ZONE_HISTORY_DAYS = 8;

export type ZoneSide = "supply" | "demand";

/** One standing zone, as stored. `t` is the open time (ms) of its first base candle. */
export interface StoredZone {
  side: ZoneSide;
  top: number;
  bottom: number;
  t: number;
  /** Returns into the box since it formed (0 = fresh). */
  tests: number;
}

export interface ZoneSet {
  /** Close time of the newest candle the zones were found on (ISO). */
  asOf: string;
  zones: StoredZone[];
}

export interface ZonesSnapshot {
  computedAt: string;
  markets: Record<string, Partial<Record<ZoneTf, ZoneSet>>>;
}

/** A zone's identity across refreshes: its timeframe, side and where it started. */
export const zoneKey = (tf: ZoneTf, z: Pick<StoredZone, "side" | "t">) => `${tf}:${z.side}:${z.t}`;

export const isInside = (price: number, z: Pick<StoredZone, "top" | "bottom">) =>
  price >= z.bottom && price <= z.top;

// ─── Alerts ───

export const ZONE_ALERT_SIDES = ["ANY", "SUPPLY", "DEMAND"] as const;
export type ZoneAlertSide = (typeof ZONE_ALERT_SIDES)[number];
export const ZONE_ALERT_SIDE_LABEL: Record<ZoneAlertSide, string> = {
  ANY: "supply or demand",
  SUPPLY: "supply",
  DEMAND: "demand",
};

const symbol = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,20}USDT$/);
const tfs = z
  .array(z.enum(ZONE_TFS))
  .min(1)
  .max(4)
  .transform((x) => [...new Set(x)].sort());

export const createZoneAlertSchema = z
  .object({
    symbol,
    tfs,
    side: z.enum(ZONE_ALERT_SIDES).default("ANY"),
    freshOnly: z.coerce.boolean().default(true),
    cooldownMin: z.coerce.number().int().min(15).max(1440).default(120),
  })
  .strict();
export type CreateZoneAlert = z.infer<typeof createZoneAlertSchema>;

export const updateZoneAlertSchema = z
  .object({
    enabled: z.boolean().optional(),
    tfs: tfs.optional(),
    side: z.enum(ZONE_ALERT_SIDES).optional(),
    freshOnly: z.boolean().optional(),
    cooldownMin: z.number().int().min(15).max(1440).optional(),
  })
  .strict();
export type UpdateZoneAlert = z.infer<typeof updateZoneAlertSchema>;

export interface ZoneAlertDto {
  id: string;
  symbol: string;
  tfs: ZoneTf[];
  side: ZoneAlertSide;
  freshOnly: boolean;
  cooldownMin: number;
  enabled: boolean;
  lastFiredAt: string | null;
  createdAt: string;
}

export interface ZoneAlertsPage {
  items: ZoneAlertDto[];
  /** Alerts this plan allows (-1 = no limit). */
  limit: number;
}

export const ZONE_ALERT_DISCLAIMER =
  "A zone marks where price turned before; it can hold or break. A record, not a signal to trade.";

export interface ZoneHit {
  tf: ZoneTf;
  zone: StoredZone;
  key: string;
}

/**
 * The zones an alert watches that the price is inside now, freshest and highest timeframe first.
 * Supply only counts at or above its bottom, demand at or below its top (both are "inside").
 */
export function zoneAlertHits(
  alert: { tfs: readonly string[]; side: ZoneAlertSide; freshOnly: boolean },
  market: Partial<Record<ZoneTf, ZoneSet>> | undefined,
  price: number,
): ZoneHit[] {
  if (!market || !(price > 0)) return [];
  const out: ZoneHit[] = [];
  for (const tf of ZONE_TFS) {
    if (!alert.tfs.includes(tf)) continue;
    for (const zone of market[tf]?.zones ?? []) {
      if (alert.side === "SUPPLY" && zone.side !== "supply") continue;
      if (alert.side === "DEMAND" && zone.side !== "demand") continue;
      if (alert.freshOnly && zone.tests > 0) continue;
      if (isInside(price, zone)) out.push({ tf, zone, key: zoneKey(tf, zone) });
    }
  }
  return out.sort(
    (a, b) => a.zone.tests - b.zone.tests || ZONE_TFS.indexOf(b.tf) - ZONE_TFS.indexOf(a.tf),
  );
}

// ─── Cockpit ladder ───

export interface CockpitZoneDto {
  tf: ZoneTf;
  side: ZoneSide;
  top: number;
  bottom: number;
  tests: number;
  /** From the price to the zone's near edge, % (0 when inside; + above, − below). */
  distPct: number;
}

/** Distance from the price to a zone's near edge, % of price. */
export function zoneDistPct(price: number, z: Pick<StoredZone, "top" | "bottom">): number {
  if (isInside(price, z)) return 0;
  return ((price < z.bottom ? z.bottom : z.top) / price - 1) * 100;
}

/** The nearest supply above and demand below on each timeframe (up to `perSide` each). */
export function nearestCockpitZones(
  market: Partial<Record<ZoneTf, ZoneSet>> | undefined,
  price: number,
  perSide = 2,
): CockpitZoneDto[] {
  if (!market || !(price > 0)) return [];
  const out: CockpitZoneDto[] = [];
  for (const tf of ZONE_TFS) {
    const zones = market[tf]?.zones ?? [];
    for (const side of ["supply", "demand"] as const) {
      const near = zones
        .filter((z) => z.side === side && (side === "supply" ? z.top >= price : z.bottom <= price))
        .map((z) => ({
          tf,
          side,
          top: z.top,
          bottom: z.bottom,
          tests: z.tests,
          distPct: zoneDistPct(price, z),
        }))
        .sort((a, b) => Math.abs(a.distPct) - Math.abs(b.distPct))
        .slice(0, perSide);
      out.push(...near);
    }
  }
  return out;
}

// ─── Trades entered at a zone ───

export interface EntryZoneHit {
  tf: ZoneTf;
  side: ZoneSide;
  fresh: boolean;
}
export interface EntryZoneDto {
  /** Close time of the candle the zones were known at. */
  at: string;
  zones: EntryZoneHit[];
}
export type StoredEntryZone = EntryZoneDto | { none: true };

/** The zones an entry price was inside, from the records in force at entry (one per timeframe). */
export function entryZoneOf(
  price: number,
  records: Partial<Record<ZoneTf, { at: Date; zones: StoredZone[] }>>,
): EntryZoneDto | null {
  const known = ZONE_TFS.filter((tf) => records[tf]);
  if (known.length === 0) return null;
  const at = new Date(Math.max(...known.map((tf) => (records[tf] as { at: Date }).at.getTime())));
  const zones: EntryZoneHit[] = [];
  for (const tf of known) {
    for (const z of (records[tf] as { zones: StoredZone[] }).zones) {
      if (isInside(price, z)) zones.push({ tf, side: z.side, fresh: z.tests === 0 });
    }
  }
  return { at: at.toISOString(), zones };
}

/** With the zone (long in demand, short in supply), against it, both (inside both kinds), or none. */
export type ZoneAlignment = "with" | "against" | "mixed" | "none";
export const ZONE_ALIGNMENT_LABEL: Record<ZoneAlignment, string> = {
  with: "At a zone, trading with it",
  against: "At a zone, trading against it",
  mixed: "Inside both a supply and a demand zone",
  none: "Not at a 1H/4H zone",
};

export function zoneAlignment(
  direction: "LONG" | "SHORT",
  e: Pick<EntryZoneDto, "zones">,
): ZoneAlignment {
  const sides = new Set(e.zones.map((z) => z.side));
  if (sides.size === 0) return "none";
  if (sides.size === 2) return "mixed";
  const withSide = direction === "LONG" ? "demand" : "supply";
  return sides.has(withSide) ? "with" : "against";
}
