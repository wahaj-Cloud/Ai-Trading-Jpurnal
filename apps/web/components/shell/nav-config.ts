import {
  Activity,
  BarChart3,
  BellRing,
  BookOpenText,
  Calculator,
  CandlestickChart,
  CircleHelp,
  ClipboardCheck,
  Compass,
  FileText,
  FlaskConical,
  LayoutDashboard,
  type LucideIcon,
  MessageSquareText,
  Newspaper,
  PlugZap,
  Radio,
  Settings,
  ShieldCheck,
  Target,
  Waves,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
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

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, available: true, mobile: true },
  { label: "Trades", href: "/trades", icon: CandlestickChart, available: true, mobile: true },
  { label: "Journal", href: "/journal", icon: BookOpenText, available: true },
  { label: "AI Coach", href: "/coach", icon: MessageSquareText, available: true, mobile: true },
  { label: "Analytics", href: "/analytics", icon: BarChart3, available: true, mobile: true },
  { label: "Lab", href: "/lab", icon: FlaskConical, available: true },
  { label: "Setup Alerts", href: "/setups", icon: BellRing, available: true },
  { label: "Live Markets", href: "/live", icon: Radio, available: true },
  { label: "Trade Check", href: "/check", icon: ClipboardCheck, available: true },
  { label: "Market Desk", href: "/desk", icon: Compass, available: true },
  { label: "Market Flow", href: "/flow", icon: Waves, available: true },
  { label: "Market Pulse", href: "/market", icon: Activity, available: true },
  { label: "Reports", href: "/reports", icon: FileText, available: true },
  { label: "News", href: "/news", icon: Newspaper, available: true },
  { label: "Goals", href: "/goals", icon: Target, available: true },
  { label: "Calculators", href: "/calculators", icon: Calculator, available: true },
  { label: "Exchanges", href: "/exchanges", icon: PlugZap, available: true },
  { label: "Settings", href: "/settings", icon: Settings, available: true },
  { label: "Help", href: "/help", icon: CircleHelp, available: true },
];
