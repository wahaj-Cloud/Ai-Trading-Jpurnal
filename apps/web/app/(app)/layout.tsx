import type { ReactNode } from "react";
import { MobileNav } from "@/components/shell/mobile-nav";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { Announcements } from "@/features/billing/announcements";
import { NotificationBell } from "@/features/notifications/bell";
import { getMe } from "@/lib/me";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await getMe();

  return (
    <div data-pnl={me.settings.pnlColorScheme} className="flex min-h-dvh">
      <Sidebar isAdmin={me.role === "ADMIN"} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar me={me} bell={<NotificationBell />} />
        <main className="flex-1 px-3 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10">
          <Announcements />
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
