import {
  BarChart3,
  BookOpenText,
  CandlestickChart,
  CircleHelp,
  FileText,
  LayoutDashboard,
  type LucideIcon,
  MessageSquareText,
  PlugZap,
  Settings,
  ShieldCheck,
  Target,
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
  { label: "Reports", href: "/reports", icon: FileText, available: true },
  { label: "Goals", href: "/goals", icon: Target, available: true },
  { label: "Exchanges", href: "/exchanges", icon: PlugZap, available: true },
  { label: "Settings", href: "/settings", icon: Settings, available: true, mobile: true },
  { label: "Help", href: "/help", icon: CircleHelp, available: true },
];
