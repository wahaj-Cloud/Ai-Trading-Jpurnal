import { z } from "zod";

/**
 * Dashboard widgets the trader can show, hide, reorder (drag and drop) and resize. The order here
 * is the default layout, most important first. `size` is the default width on large screens: full
 * row, two-thirds, one-third (next to a two-thirds one) or a third. `group` sorts the widget
 * library; `home` is the page where the full version of a market widget lives. Widgets marked
 * `defaultHidden` repeat what the Analytics page shows in full, so a new dashboard starts focused.
 */
export const DASHBOARD_GROUPS = [
  { id: "performance", label: "Performance" },
  { id: "coach", label: "Coach and discipline" },
  { id: "trading", label: "Trading" },
  { id: "markets", label: "Markets" },
] as const;
export type DashboardGroup = (typeof DASHBOARD_GROUPS)[number]["id"];

export const DASHBOARD_SIZES = ["full", "wide", "narrow", "third"] as const;
export type DashboardWidgetSize = (typeof DASHBOARD_SIZES)[number];
export const DASHBOARD_SIZE_LABEL: Record<DashboardWidgetSize, string> = {
  full: "Full",
  wide: "2/3",
  narrow: "1/3",
  third: "1/3",
};

interface WidgetDef {
  id: string;
  label: string;
  size: DashboardWidgetSize;
  group: DashboardGroup;
  description: string;
  home?: { href: string; label: string };
  defaultHidden?: boolean;
}

export const DASHBOARD_WIDGETS = [
  {
    id: "kpis",
    label: "Key numbers",
    size: "full",
    group: "performance",
    description: "Net P&L, win rate, profit factor, expectancy, drawdown and fees.",
  },
  {
    id: "high-impact-news",
    label: "High-impact news",
    size: "full",
    group: "markets",
    description:
      "Every high-impact headline (wars, central banks, crises, crypto shocks) and the next big release, live.",
    home: { href: "/news/top", label: "Top stories" },
  },
  {
    id: "equity",
    label: "Equity curve",
    size: "wide",
    group: "performance",
    description: "Your account growth trade by trade.",
  },
  {
    id: "coach",
    label: "Your coach",
    size: "narrow",
    group: "coach",
    description: "Today's note from your AI coach.",
  },
  {
    id: "psychology",
    label: "Discipline score and psychological tax",
    size: "full",
    group: "coach",
    description: "How disciplined you traded and what emotional trades cost.",
  },
  {
    id: "recommendations",
    label: "Recommended improvements",
    size: "full",
    group: "coach",
    description: "The changes that would help your results most.",
  },
  {
    id: "open-positions",
    label: "Open positions",
    size: "full",
    group: "trading",
    description: "Live positions on your connected exchanges.",
  },
  {
    id: "market-sessions",
    label: "Market sessions clock",
    size: "wide",
    group: "markets",
    description: "Which markets are open now, in your time zone.",
  },
  {
    id: "trade-check",
    label: "Trade Check summary",
    size: "narrow",
    group: "markets",
    description: "Readings for and against longs and shorts, with risk flags.",
    home: { href: "/check", label: "Trade Check" },
  },
  {
    id: "scalping",
    label: "Scalping strength",
    size: "narrow",
    group: "markets",
    description: "Buying or selling strength from 5m to 1D for Bitcoin and your last traded coin.",
    home: { href: "/scalp", label: "Scalping" },
  },
  {
    id: "order-flow",
    label: "Order flow",
    size: "narrow",
    group: "markets",
    description: "How many top coins are being net bought or sold, and the biggest flows each way.",
    home: { href: "/orderflow", label: "Order Flow" },
  },
  {
    id: "calendar",
    label: "Calendar",
    size: "wide",
    group: "performance",
    description: "Each day's result on a calendar.",
  },
  {
    id: "wins-losses",
    label: "Wins and losses",
    size: "narrow",
    group: "performance",
    description: "Winning and losing trades side by side.",
  },
  {
    id: "daily-pnl",
    label: "Net daily P&L",
    size: "wide",
    group: "performance",
    description: "Result of every trading day.",
  },
  {
    id: "economic-calendar",
    label: "Economic calendar (news)",
    size: "narrow",
    group: "markets",
    description: "Upcoming high-impact releases.",
    home: { href: "/news", label: "News" },
  },
  {
    id: "market-overview",
    label: "Crypto market (CoinMarketCap)",
    size: "full",
    group: "markets",
    description: "Total market cap, Fear & Greed and Altcoin Season.",
    home: { href: "/market", label: "Market Pulse" },
  },
  {
    id: "market-flow",
    label: "Trend bias and market flow",
    size: "full",
    group: "markets",
    description: "1D/4H/1H trend, whale flow and liquidations per market.",
    home: { href: "/flow", label: "Market Flow" },
  },
  {
    id: "goals",
    label: "Goals",
    size: "full",
    group: "trading",
    description: "Progress on your weekly and monthly goals.",
  },
  {
    id: "latest-trades",
    label: "Latest trades",
    size: "full",
    group: "trading",
    description: "Your most recent closed trades.",
  },
  {
    id: "streaks",
    label: "Streaks",
    size: "third",
    group: "performance",
    description: "Winning and losing streaks.",
  },
  {
    id: "winning-days",
    label: "Winning days",
    size: "third",
    group: "performance",
    description: "Share of days that ended in profit.",
  },
  {
    id: "symbols",
    label: "Symbols traded",
    size: "third",
    group: "performance",
    description: "Where your trades and P&L come from.",
  },
  {
    id: "best-session",
    label: "Your best session",
    size: "narrow",
    group: "performance",
    description: "The market session you trade best in.",
  },
  {
    id: "sessions",
    label: "Trading sessions, hour by hour",
    size: "full",
    group: "performance",
    description: "Results by session and hour.",
    defaultHidden: true,
  },
  {
    id: "hourly",
    label: "Trade distribution by hour",
    size: "full",
    group: "performance",
    description: "Wins and losses by the hour you traded.",
    defaultHidden: true,
  },
  {
    id: "coins",
    label: "Coins",
    size: "third",
    group: "performance",
    description: "P&L per coin.",
    defaultHidden: true,
  },
  {
    id: "long-short",
    label: "Long vs short",
    size: "third",
    group: "performance",
    description: "Your longs against your shorts.",
    defaultHidden: true,
  },
  {
    id: "weekday",
    label: "By weekday",
    size: "third",
    group: "performance",
    description: "Results by the day you opened.",
    defaultHidden: true,
  },
  {
    id: "yearly",
    label: "Yearly performance",
    size: "full",
    group: "performance",
    description: "Month by month, year by year.",
    defaultHidden: true,
  },
] as const satisfies readonly WidgetDef[];

export type DashboardWidgetId = (typeof DASHBOARD_WIDGETS)[number]["id"];
export const WIDGET_INFO: ReadonlyMap<string, WidgetDef> = new Map(
  (DASHBOARD_WIDGETS as readonly WidgetDef[]).map((w) => [w.id, w]),
);
export interface DashboardSlot {
  id: DashboardWidgetId;
  hidden: boolean;
  /** The trader's chosen width; the widget's default when absent. */
  size?: DashboardWidgetSize;
}
export type DashboardLayout = DashboardSlot[];

const IDS: ReadonlySet<string> = new Set(DASHBOARD_WIDGETS.map((w) => w.id));

/**
 * What the API accepts. Unknown ids are allowed (an older or newer app version may send them) and
 * are dropped by normalizeLayout, so a layout never breaks when widgets are added or retired.
 */
export const dashboardLayoutSchema = z
  .array(
    z
      .object({
        id: z.string().min(1).max(40),
        hidden: z.boolean(),
        size: z.enum(DASHBOARD_SIZES).optional(),
      })
      .strict(),
  )
  .max(60);

/** A slot's width: the trader's choice, else the widget's default. */
export const slotSize = (slot: DashboardSlot): DashboardWidgetSize =>
  slot.size ?? WIDGET_INFO.get(slot.id)?.size ?? "full";

const hiddenByDefault = (id: string) => WIDGET_INFO.get(id)?.defaultHidden === true;

export const defaultLayout = (): DashboardLayout =>
  DASHBOARD_WIDGETS.map((w) => ({ id: w.id, hidden: hiddenByDefault(w.id) }));

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
    out.push({
      id: s.id as DashboardWidgetId,
      hidden: s.hidden,
      ...(s.size && s.size !== WIDGET_INFO.get(s.id)?.size ? { size: s.size } : {}),
    });
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
    out.splice(at, 0, { id: w.id, hidden: hiddenByDefault(w.id) });
  });
  return out;
}
