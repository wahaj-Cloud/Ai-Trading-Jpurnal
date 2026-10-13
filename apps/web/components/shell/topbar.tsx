import type { MeResponse } from "@atc/shared";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";

export function Topbar({ me, bell }: { me: MeResponse; bell?: React.ReactNode }) {
  return (
    <header className="surface sticky top-3 z-20 mx-3 mt-3 flex h-14 items-center gap-4 rounded-[var(--radius-surface)] px-4 sm:mx-6 lg:mx-8">
      <Link href="/dashboard" className="lg:hidden" aria-label="AI Trading Coach home">
        <LogoMark className="h-7 w-7" />
      </Link>
      <div className="flex-1" />
      <Link
        href="/billing"
        className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs text-ink-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:border-coach hover:text-ink"
      >
        {me.plan.name} plan
      </Link>
      {bell}
      <UserButton />
    </header>
  );
}
