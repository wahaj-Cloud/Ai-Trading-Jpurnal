import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/logo";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <Link href="/" aria-label="AI Trading Coach home">
        <Wordmark />
      </Link>
      <article className="mt-10 grid gap-4 text-sm leading-relaxed text-ink-muted [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-ink [&_h2]:mt-4 [&_h2]:font-semibold [&_h2]:text-ink">
        {children}
      </article>
      <nav aria-label="Legal" className="mt-12 flex gap-4 text-xs text-ink-faint">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/risk-disclosure">Risk disclosure</Link>
      </nav>
    </div>
  );
}
