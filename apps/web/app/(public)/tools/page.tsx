import type { Metadata } from "next";
import Link from "next/link";
import { PUBLIC_TOOLS, SITE_URL } from "@/features/tools/catalog";
import { SignupCta } from "./cta";

export const metadata: Metadata = {
  title: "Free trading calculators and trade grader",
  description:
    "Free tools for crypto futures traders: trade grader, position size, risk/reward, profit with fees, expectancy, Kelly, risk of ruin and Monte Carlo.",
  alternates: { canonical: `${SITE_URL}/tools` },
};

export default function ToolsIndex() {
  const [grader, ...rest] = PUBLIC_TOOLS;
  return (
    <div className="grid gap-10 pt-6">
      <header className="max-w-3xl">
        <p className="text-sm font-medium text-coach">Free · no sign-up</p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          Trading tools that keep you in the game
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-muted">
          Size your positions, check your risk and grade a trade before you take it. Everything runs
          in your browser.
        </p>
      </header>

      {grader && (
        <Link
          href={`/tools/${grader.slug}`}
          className="surface group grid gap-2 rounded-[var(--radius-surface)] p-6 transition-transform hover:-translate-y-0.5 sm:p-8"
        >
          <span className="w-fit rounded-full bg-coach/15 px-2.5 py-0.5 text-xs font-semibold text-coach">
            Most popular
          </span>
          <h2 className="text-2xl font-semibold tracking-tight">{grader.name}</h2>
          <p className="max-w-2xl text-ink-muted">{grader.description}</p>
          <span className="mt-1 text-sm font-medium text-coach group-hover:underline">
            Grade my trade →
          </span>
        </Link>
      )}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rest.map((t) => (
          <li key={t.slug}>
            <Link
              href={`/tools/${t.slug}`}
              className="surface grid h-full content-start gap-2 rounded-[var(--radius-surface)] p-5 transition-transform hover:-translate-y-0.5"
            >
              <h2 className="font-semibold">{t.name}</h2>
              <p className="text-sm text-ink-muted">{t.description}</p>
            </Link>
          </li>
        ))}
      </ul>

      <SignupCta />
    </div>
  );
}
