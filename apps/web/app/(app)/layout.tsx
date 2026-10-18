import type { ReactNode } from "react";
import { MobileNav } from "@/components/shell/mobile-nav";
import { SectionTabs } from "@/components/shell/section-tabs";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { Announcements } from "@/features/billing/announcements";
import { HelpWidget } from "@/features/help/help-widget";
import { LiveNewsProvider } from "@/features/news/live-news";
import { NotificationBell } from "@/features/notifications/bell";
import { serverEnv } from "@/lib/env";
import { getMe } from "@/lib/me";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await getMe();

  // Live economic results stream straight from the API to the browser (public market data).
  const apiUrl = serverEnv().API_URL;

  return (
    <LiveNewsProvider apiUrl={apiUrl}>
      <div data-pnl={me.settings.pnlColorScheme} className="flex min-h-dvh">
        <Sidebar isAdmin={me.role === "ADMIN"} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar me={me} bell={<NotificationBell />} />
          <main className="flex-1 px-3 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10">
            <Announcements />
            <SectionTabs isAdmin={me.role === "ADMIN"} />
            {children}
          </main>
        </div>
        <MobileNav isAdmin={me.role === "ADMIN"} />
        <HelpWidget />
      </div>
    </LiveNewsProvider>
  );
}
