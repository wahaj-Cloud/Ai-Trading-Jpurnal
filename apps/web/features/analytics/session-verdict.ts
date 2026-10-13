import { type BucketDto, SESSIONS, type SessionId } from "@atc/shared";

/** Below this many trades a session's result is mostly noise, so it is not ranked. */
export const MIN_SESSION_TRADES = 5;

/** Session windows by opening time, in UTC hours (end exclusive). Mirrors @atc/analytics. */
const WINDOWS: Record<SessionId, [number, number]> = {
  ASIA: [0, 7],
  LONDON: [7, 13],
  NEW_YORK: [13, 21],
  OFF_HOURS: [21, 24],
};

export interface SessionRow {
  id: SessionId;
  label: string;
  /** Opening-time window in the user's timezone, e.g. "12:00–18:00". */
  localHours: string;
  trades: number;
  winRate: number | null;
  pnl: string;
  avgPnl: string | null;
  ranked: boolean;
}

export type SessionVerdict =
  | { kind: "none"; rows: SessionRow[] }
  | { kind: "too-few"; rows: SessionRow[] }
  | {
      kind: "ranked";
      rows: SessionRow[];
      best: SessionRow;
      /** Only set when it differs from best and lost money. */
      worst: SessionRow | null;
      bestIsProfitable: boolean;
    };

const isSession = (k: string): k is SessionId => k in SESSIONS;

/** "HH:00" for a UTC hour, shown in the given timezone (on the given day, so DST is right). */
export function localHour(utcHour: number, timeZone: string, day: Date): string {
  const at = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), utcHour % 24),
  );
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(at);
  } catch {
    return `${String(utcHour % 24).padStart(2, "0")}:00`;
  }
}

/**
 * Turns the per-session buckets into a plain answer: which session pays, which one costs.
 * Ranks by net P&L, and only sessions with enough trades to mean something.
 */
export function sessionVerdict(
  buckets: readonly BucketDto[],
  timeZone: string,
  today: Date = new Date(),
): SessionVerdict {
  const rows: SessionRow[] = buckets
    .filter((b): b is BucketDto & { key: SessionId } => isSession(b.key) && b.trades > 0)
    .map((b) => {
      const [from, to] = WINDOWS[b.key];
      return {
        id: b.key,
        label: SESSIONS[b.key].label,
        localHours: `${localHour(from, timeZone, today)}–${localHour(to, timeZone, today)}`,
        trades: b.trades,
        winRate: b.winRate,
        pnl: b.pnl,
        avgPnl: b.avgPnl,
        ranked: b.trades >= MIN_SESSION_TRADES,
      };
    })
    .sort((a, b) => Number(b.pnl) - Number(a.pnl));

  if (rows.length === 0) return { kind: "none", rows };
  const ranked = rows.filter((r) => r.ranked);
  if (ranked.length < 2) return { kind: "too-few", rows };

  const best = ranked[0] as SessionRow;
  const last = ranked[ranked.length - 1] as SessionRow;
  const worst = last.id !== best.id && Number(last.pnl) < 0 ? last : null;
  return { kind: "ranked", rows, best, worst, bestIsProfitable: Number(best.pnl) > 0 };
}

export const UTC_START: Record<SessionId, number> = {
  ASIA: 0,
  LONDON: 7,
  NEW_YORK: 13,
  OFF_HOURS: 21,
};
export const UTC_END: Record<SessionId, number> = {
  ASIA: 7,
  LONDON: 13,
  NEW_YORK: 21,
  OFF_HOURS: 24,
};

/** Minutes the timezone is ahead of UTC today (0–1439), from the same formatter as the labels. */
export function offsetMinutes(timeZone: string, day: Date): number {
  const [h, m] = localHour(0, timeZone, day).split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** A session's window on the local 24-hour line, split in two when it crosses midnight. */
export function localSegments(id: SessionId, offset: number): Array<[number, number]> {
  const start = (UTC_START[id] * 60 + offset) % 1440;
  const length = (UTC_END[id] - UTC_START[id]) * 60;
  const end = start + length;
  return end <= 1440
    ? [[start, end]]
    : [
        [start, 1440],
        [0, end - 1440],
      ];
}
