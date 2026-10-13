import type { MeResponse } from "@atc/shared";
import { UserButton } from "@clerk/nextjs";
import { Settings } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { CommandBar } from "@/features/search/command-bar";
import { CurrencyMenu } from "@/features/shell/currency-menu";
import { FullscreenButton } from "@/features/shell/fullscreen-button";
import { MarketClock } from "@/features/shell/market-clock";
import { ThemePanel } from "@/features/theme/theme-panel";

/**
 * Top bar: search on the left; on the right, the market clock, currency, notifications,
 * full screen, theme and the account cluster.
 */
export function Topbar({ me, bell }: { me: MeResponse; bell?: React.ReactNode }) {
  return (
    <header className="surface sticky top-3 z-20 mx-3 mt-3 flex h-14 items-center gap-2 rounded-[var(--radius-surface)] px-3 sm:mx-6 sm:gap-3 sm:px-4 lg:mx-8">
      <Link href="/dashboard" className="lg:hidden" aria-label="WickMentor home">
        <LogoMark className="h-7 w-7" />
      </Link>
      <CommandBar isAdmin={me.role === "ADMIN"} />
      <div className="hidden flex-1 lg:block" />
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        <MarketClock timeZone={me.timezone} />
        <CurrencyMenu current={me.displayCurrency} />
        {bell}
        <FullscreenButton />
        <ThemePanel />
        <div className="ml-1 flex items-center gap-1 rounded-full border border-hi/10 bg-hi/[0.05] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
          <UserButton />
          <Link
            href="/settings"
            title="Settings"
            className="hidden h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-hi/[0.1] hover:text-ink sm:flex"
          >
            <Settings className="h-[18px] w-[18px]" aria-hidden="true" />
            <span className="sr-only">Settings</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
