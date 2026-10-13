import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";

export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-5 sm:px-8">
      <header className="flex h-20 items-center justify-between">
        <Wordmark />
        <ButtonLink href="/sign-in" variant="ghost" size="sm">
          Sign in
        </ButtonLink>
      </header>

      <main className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div>
          <h1 className="max-w-[16ch] text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Every futures trade you take, reviewed.
          </h1>
          <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-ink-muted">
            Connect Binance, MEXC, KuCoin or BingX with read-only keys, one exchange or all four.
            Your journal builds itself, and your coach shows you which habits are costing you money.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/sign-up" size="lg">
              Create free account
            </ButtonLink>
            <ButtonLink href="/sign-in" variant="secondary" size="lg">
              Sign in
            </ButtonLink>
          </div>
          <p className="mt-6 text-sm text-ink-faint">
            Read-only access. We never place trades or move funds.
          </p>
        </div>
        <ExampleReview />
      </main>
      <footer className="flex flex-wrap gap-4 border-t border-rule py-6 text-xs text-ink-faint">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/risk-disclosure">Risk disclosure</Link>
        <span>Educational tool, not financial advice.</span>
      </footer>
    </div>
  );
}

/** Illustrative only — shows the shape of a review, clearly labelled as an example. */
function ExampleReview() {
  return (
    <figure className="rounded-[var(--radius-surface)] surface p-6 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.8)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold">BTCUSDT long, 10x</p>
          <p className="mt-0.5 text-sm text-ink-muted">Held 2h 14m, 3 fills</p>
        </div>
        <div className="text-right">
          <p className="figures text-xl font-semibold text-[#26b07e]">+412.30</p>
          <p className="figures text-sm text-ink-muted">+1.8R</p>
        </div>
      </div>
      <div className="mt-6 flex items-center gap-4 border-t border-rule pt-5">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-coach text-lg font-semibold text-coach">
          B+
        </span>
        <p className="text-sm leading-relaxed text-ink-muted">
          Clean entry on the retest of the session high. You closed half at 1R, then moved your stop
          to entry, which protected the trade well.
        </p>
      </div>
      <div className="mt-5 rounded-[var(--radius-control)] bg-raised p-4">
        <p className="text-sm font-medium text-coach">Focus for tomorrow</p>
        <p className="mt-1 text-sm text-ink-muted">
          Your last three losses were re-entries within ten minutes of a stop-out. Wait for a new
          setup before entering again.
        </p>
      </div>
      <figcaption className="mt-4 text-xs text-ink-faint">Example review</figcaption>
    </figure>
  );
}
