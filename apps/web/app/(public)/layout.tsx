import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";

/** Public pages (no sign-in): free tools that bring traders in. */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-8">
      <header className="flex h-20 items-center justify-between gap-3">
        <Link href="/" aria-label="WickMentor home">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/tools"
            className="hidden rounded-full px-3 py-1.5 text-sm text-ink-muted hover:text-ink sm:inline"
          >
            Free tools
          </Link>
          <ButtonLink href="/sign-in" variant="ghost" size="sm">
            Sign in
          </ButtonLink>
          <ButtonLink href="/sign-up" size="sm">
            Start free
          </ButtonLink>
        </nav>
      </header>
      <main className="flex-1 pb-16">{children}</main>
      <footer className="flex flex-wrap gap-4 border-t border-rule py-6 text-xs text-ink-faint">
        <Link href="/tools">Free trading tools</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/risk-disclosure">Risk disclosure</Link>
        <span>Educational tools, not financial advice.</span>
      </footer>
    </div>
  );
}
