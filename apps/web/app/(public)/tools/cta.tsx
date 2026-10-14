import { ButtonLink } from "@/components/ui/button";

/** The hand-off from a free tool to the product. */
export function SignupCta() {
  return (
    <section className="surface relative overflow-hidden rounded-[var(--radius-surface)] p-6 sm:p-8">
      <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-coach/25 blur-3xl" />
      <h2 className="text-xl font-semibold tracking-tight">
        Get this for every trade, automatically
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
        Connect Binance, MEXC, KuCoin, BingX or Exness with a read-only key. WickMentor grades every
        trade you close, finds the habits that cost you money, and an AI coach tells you what to fix
        next. Free to start.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <ButtonLink href="/sign-up">Create free account</ButtonLink>
        <ButtonLink href="/tools" variant="secondary">
          More free tools
        </ButtonLink>
      </div>
    </section>
  );
}
