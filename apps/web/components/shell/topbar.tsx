import type { MeResponse } from "@atc/shared";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";

export function Topbar({ me, bell }: { me: MeResponse; bell?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-rule bg-canvas/90 px-4 backdrop-blur sm:px-6">
      <Link href="/dashboard" className="lg:hidden" aria-label="AI Trading Coach home">
        <LogoMark className="h-7 w-7" />
      </Link>
      <div className="flex-1" />
      <Link
        href="/billing"
        className="rounded-full border border-rule px-2.5 py-0.5 text-xs text-ink-muted hover:border-coach hover:text-ink"
      >
        {me.plan.name} plan
      </Link>
      {bell}
      <UserButton />
    </header>
  );
}
