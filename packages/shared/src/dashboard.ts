import { z } from "zod";

/**
 * Dashboard widgets the trader can show, hide and reorder. The order here is the default layout.
 * `size` is the widget's width on large screens: full row, two-thirds, one-third.
 */
export const DASHBOARD_WIDGETS = [
  { id: "market-sessions", label: "Market sessions clock", size: "wide" },
  { id: "best-session", label: "Your best session", size: "narrow" },
  { id: "kpis", label: "Key numbers", size: "full" },
  { id: "recommendations", label: "Recommended improvements", size: "full" },
  { id: "equity", label: "Equity curve", size: "wide" },
  { id: "wins-losses", label: "Wins and losses", size: "narrow" },
  { id: "sessions", label: "Trading sessions, hour by hour", size: "full" },
  { id: "calendar", label: "Calendar", size: "wide" },
  { id: "coach", label: "Your coach", size: "narrow" },
  { id: "streaks", label: "Streaks", size: "third" },
  { id: "winning-days", label: "Winning days", size: "third" },
  { id: "symbols", label: "Symbols traded", size: "third" },
  { id: "daily-pnl", label: "Net daily P&L", size: "wide" },
  { id: "economic-calendar", label: "Economic calendar (news)", size: "narrow" },
  { id: "hourly", label: "Trade distribution by hour", size: "full" },
  { id: "coins", label: "Coins", size: "third" },
  { id: "long-short", label: "Long vs short", size: "third" },
  { id: "weekday", label: "By weekday", size: "third" },
  { id: "yearly", label: "Yearly performance", size: "full" },
  { id: "open-positions", label: "Open positions", size: "full" },
  { id: "goals", label: "Goals", size: "full" },
  { id: "latest-trades", label: "Latest trades", size: "full" },
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGETS)[number]["id"];
export type DashboardWidgetSize = (typeof DASHBOARD_WIDGETS)[number]["size"];
export interface DashboardSlot {
  id: DashboardWidgetId;
  hidden: boolean;
}
export type DashboardLayout = DashboardSlot[];

const IDS: ReadonlySet<string> = new Set(DASHBOARD_WIDGETS.map((w) => w.id));

/**
 * What the API accepts. Unknown ids are allowed (an older or newer app version may send them) and
 * are dropped by normalizeLayout, so a layout never breaks when widgets are added or retired.
 */
export const dashboardLayoutSchema = z
  .array(z.object({ id: z.string().min(1).max(40), hidden: z.boolean() }).strict())
  .max(60);

export const defaultLayout = (): DashboardLayout =>
  DASHBOARD_WIDGETS.map((w) => ({ id: w.id, hidden: false }));

/**
 * Turns whatever is stored into a complete, valid layout: saved order and visibility for known
 * widgets (first occurrence wins). A widget the trader has never seen (added in a later release)
 * is shown, placed right after the widget that precedes it in the default order, or at the end.
 */
export function normalizeLayout(saved: unknown): DashboardLayout {
  const parsed = dashboardLayoutSchema.safeParse(saved);
  if (!parsed.success) return defaultLayout();
  const seen = new Set<string>();
  const out: DashboardLayout = [];
  for (const s of parsed.data) {
    if (!IDS.has(s.id) || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ id: s.id as DashboardWidgetId, hidden: s.hidden });
  }
  DASHBOARD_WIDGETS.forEach((w, i) => {
    if (seen.has(w.id)) return;
    seen.add(w.id);
    let at = out.length;
    for (let j = i - 1; j >= 0; j--) {
      const prev = out.findIndex((s) => s.id === DASHBOARD_WIDGETS[j]?.id);
      if (prev >= 0) {
        at = prev + 1;
        break;
      }
    }
    out.splice(at, 0, { id: w.id, hidden: false });
  });
  return out;
}
