import {
  Activity,
  BarChart3,
  BellRing,
  Bitcoin,
  BookOpenText,
  Bot,
  Calculator,
  CalendarDays,
  CandlestickChart,
  CircleHelp,
  ClipboardCheck,
  Compass,
  FileText,
  FlaskConical,
  Gauge,
  Globe,
  Landmark,
  LayoutDashboard,
  type LucideIcon,
  MessageSquareText,
  Newspaper,
  PlugZap,
  Radio,
  Settings,
  ShieldCheck,
  Siren,
  Split,
  Target,
  Waves,
  Zap,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  /** Active only on this exact address (a folder's main page with sub-pages below it). */
  exact?: boolean;
  icon: LucideIcon;
  /** Roadmap phase that ships this screen; items not yet built render disabled. */
  available: boolean;
  mobile?: boolean;
}

/** Shown only to admins (the admin pages and API check the role again). */
export const ADMIN_ITEM: NavItem = {
  label: "Admin",
  href: "/admin",
  icon: ShieldCheck,
  available: true,
};

export interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

/**
 * The app's folders. Dashboard stands alone; every other page sits in the folder it belongs to.
 * Pages inside a folder show the folder's tabs at the top, so related pages are one click apart.
 */
export const NAV_HOME: NavItem = {
  label: "Dashboard",
  href: "/dashboard",
  icon: LayoutDashboard,
  available: true,
  mobile: true,
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "journal",
    label: "Journal",
    icon: BookOpenText,
    items: [
      { label: "Trades", href: "/trades", icon: CandlestickChart, available: true, mobile: true },
      { label: "Journal", href: "/journal", icon: BookOpenText, available: true },
      { label: "Analytics", href: "/analytics", icon: BarChart3, available: true, mobile: true },
      { label: "Reports", href: "/reports", icon: FileText, available: true },
      { label: "Goals", href: "/goals", icon: Target, available: true },
    ],
  },
  {
    id: "coach",
    label: "Coach and tools",
    icon: MessageSquareText,
    items: [
      { label: "AI Coach", href: "/coach", icon: MessageSquareText, available: true, mobile: true },
      { label: "Strategy Lab", href: "/lab", icon: FlaskConical, available: true },
      { label: "Paper Bots", href: "/lab/paper", icon: Bot, available: true },
      { label: "Setup Alerts", href: "/setups", icon: BellRing, available: true },
      { label: "Calculators", href: "/calculators", icon: Calculator, available: true },
    ],
  },
  {
    id: "markets",
    label: "Markets",
    icon: Radio,
    items: [
      { label: "Live Charts", href: "/live", icon: Radio, available: true },
      { label: "Trade Check", href: "/check", icon: ClipboardCheck, available: true },
      { label: "Market Desk", href: "/desk", icon: Compass, available: true },
      { label: "Scalp Cockpit", href: "/cockpit", icon: Gauge, available: true },
      { label: "Scalping", href: "/scalp", icon: Zap, available: true },
      { label: "Order Flow", href: "/orderflow", icon: Split, available: true },
      { label: "Market Flow", href: "/flow", icon: Waves, available: true },
      { label: "Market Pulse", href: "/market", icon: Activity, available: true },
    ],
  },
  {
    id: "news",
    label: "News",
    icon: Newspaper,
    items: [
      { label: "Top stories", href: "/news/top", icon: Siren, available: true },
      { label: "World & geopolitics", href: "/news/world", icon: Globe, available: true },
      {
        label: "Central banks & FOMC",
        href: "/news/central-banks",
        icon: Landmark,
        available: true,
      },
      {
        label: "Economic calendar",
        href: "/news",
        icon: CalendarDays,
        available: true,
        exact: true,
      },
      { label: "Crypto news", href: "/news/crypto", icon: Bitcoin, available: true },
      { label: "Markets & companies", href: "/news/markets", icon: Newspaper, available: true },
    ],
  },
  {
    id: "account",
    label: "Account",
    icon: Settings,
    items: [
      { label: "Exchanges", href: "/exchanges", icon: PlugZap, available: true },
      { label: "Settings", href: "/settings", icon: Settings, available: true },
      { label: "Help", href: "/help", icon: CircleHelp, available: true },
    ],
  },
];

/** The folders for this user (admins also see Admin under Account). */
export function navGroups(isAdmin: boolean): NavGroup[] {
  return NAV_GROUPS.map((g) =>
    g.id === "account" && isAdmin ? { ...g, items: [...g.items, ADMIN_ITEM] } : g,
  );
}

/** Every page, flat, in menu order. */
export const NAV_ITEMS: NavItem[] = [NAV_HOME, ...NAV_GROUPS.flatMap((g) => g.items)];

export const isActivePath = (pathname: string, href: string, exact = false) =>
  pathname === href || (!exact && pathname.startsWith(`${href}/`));

/** Active when it matches and no deeper page matches too (/lab/paper is Paper Bots, not /lab). */
export const isActiveItem = (pathname: string, item: NavItem) =>
  isActivePath(pathname, item.href, item.exact) &&
  !NAV_ITEMS.some(
    (o) =>
      o.href.length > item.href.length &&
      o.href.startsWith(`${item.href}/`) &&
      isActivePath(pathname, o.href, o.exact),
  );

/** The folder holding the current page, if any. */
export function groupOf(pathname: string, isAdmin = false): NavGroup | null {
  return (
    navGroups(isAdmin).find((g) => g.items.some((i) => isActivePath(pathname, i.href))) ?? null
  );
}
