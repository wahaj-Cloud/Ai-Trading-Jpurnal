import { EXCHANGE_CATALOG, EXCHANGE_IDS } from "@atc/shared";
import { ArrowLeft, Check, KeyRound, Lock, ShieldCheck, Sparkles, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark, Wordmark } from "@/components/brand/logo";
import { ExchangeMark } from "@/features/exchanges/exchange-mark";
import { cn } from "@/lib/cn";

export type AuthMode = "sign-up" | "sign-in";

const COPY = {
  "sign-up": {
    eyebrow: "Free plan · no card needed",
    title: ["Turn every trade", "into a lesson."],
    sub: "Connect a read-only exchange key and WickMentor journals, grades and coaches every futures trade you take, automatically.",
    switchText: "Already have an account?",
    switchLabel: "Sign in",
    switchHref: "/sign-in",
  },
  "sign-in": {
    eyebrow: "Welcome back",
    title: ["Your journal kept", "working while you were away."],
    sub: "New trades are synced, reviewed and waiting for you, along with today's coaching note.",
    switchText: "New to WickMentor?",
    switchLabel: "Create a free account",
    switchHref: "/sign-up",
  },
} as const;

const STEPS = [
  { title: "Create your account", time: "30 seconds" },
  { title: "Connect a read-only key", time: "about 2 minutes" },
  { title: "Get your first AI trade reviews", time: "minutes after the sync" },
];

const TRUST = [
  { icon: KeyRound, label: "Read-only keys only" },
  { icon: Lock, label: "AES-256 encrypted" },
  { icon: ShieldCheck, label: "Never places trades" },
];

/**
 * Split sign-in / sign-up screen: the account form on one side, and on the other what the
 * product does, what happens next and how keys are protected. Everything shown is either real
 * product behaviour or clearly labelled as an example.
 */
export function AuthShell({
  mode,
  planNote,
  children,
}: {
  mode: AuthMode;
  /** Shown above the form when the visitor picked a paid plan on the pricing section. */
  planNote?: ReactNode;
  children: ReactNode;
}) {
  const c = COPY[mode];
  return (
    <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] bg-sheet lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
      {/* Form side: first on mobile, right on desktop. */}
      <div className="relative flex flex-col px-4 py-5 sm:px-8 lg:order-2 lg:min-h-dvh lg:px-12">
        <header className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full py-1.5 pr-3 text-sm text-ink-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Back to home</span>
            <span className="sm:hidden">Home</span>
          </Link>
          <Link href="/" aria-label="WickMentor home" className="lg:hidden">
            <Wordmark />
          </Link>
          <p className="hidden text-sm text-ink-muted sm:block">
            {c.switchText}{" "}
            <Link
              href={c.switchHref}
              className="font-medium text-coach underline-offset-4 hover:underline"
            >
              {c.switchLabel}
            </Link>
          </p>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center py-8 lg:py-10">
          <div className="landing-fade grid w-full max-w-[420px] justify-items-center gap-5">
            {planNote}
            {children}
          </div>
        </main>

        <footer className="text-center text-xs leading-relaxed text-ink-faint">
          By continuing you agree to our{" "}
          <Link href="/terms" className="underline underline-offset-2 hover:text-ink-muted">
            Terms
          </Link>
          ,{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-ink-muted">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link
            href="/risk-disclosure"
            className="underline underline-offset-2 hover:text-ink-muted"
          >
            Risk Disclosure
          </Link>
          .
        </footer>
      </div>

      {/* Brand side: left on desktop, below the form on mobile. */}
      <aside
        aria-label="About WickMentor"
        className="relative overflow-hidden border-t border-hi/10 lg:order-1 lg:border-t-0 lg:border-r"
      >
        <BrandBackdrop />
        <div className="relative flex h-full flex-col gap-8 px-4 py-10 sm:px-10 lg:px-14 lg:py-10 xl:px-20">
          <Link href="/" aria-label="WickMentor home" className="hidden w-fit lg:block">
            <Wordmark />
          </Link>

          <div className="grid gap-4 lg:my-auto">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-coach/30 bg-coach/10 px-3 py-1 text-xs font-medium text-coach">
              <span className="h-1.5 w-1.5 rounded-full bg-profit" aria-hidden="true" />
              {c.eyebrow}
            </span>
            <h1 className="max-w-[20ch] text-3xl font-semibold tracking-tight text-ink sm:text-4xl xl:text-[2.75rem] xl:leading-[1.1]">
              {c.title[0]}{" "}
              <span className="bg-[linear-gradient(90deg,#7cc4ff,#4d94ff_45%,#8b5cf6)] bg-clip-text text-transparent">
                {c.title[1]}
              </span>
            </h1>
            <p className="max-w-[52ch] leading-relaxed text-ink-muted">{c.sub}</p>

            <ExampleReview />

            {mode === "sign-up" && <NextSteps />}
          </div>

          <div className="grid gap-4">
            <ul className="flex flex-wrap gap-2">
              {TRUST.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-hi/10 bg-hi/[0.04] px-3 py-1.5 text-xs text-ink-muted"
                >
                  <Icon className="h-3.5 w-3.5 text-profit" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-xs tracking-wide text-ink-faint uppercase">Works with</span>
              <ul className="flex flex-wrap items-center gap-3">
                {EXCHANGE_IDS.map((id) => (
                  <li key={id} className="flex items-center gap-1.5 text-xs text-ink-muted">
                    <ExchangeMark exchange={id} size="sm" />
                    {EXCHANGE_CATALOG[id].name}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function BrandBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 bg-[linear-gradient(160deg,#0d1442_0%,#070b25_45%,#050819_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_at_30%_20%,black,transparent_75%)]" />
      <div className="absolute -top-40 -left-32 h-[28rem] w-[28rem] rounded-full bg-[#4d94ff]/20 blur-[120px]" />
      <div className="absolute -right-24 bottom-0 h-[22rem] w-[22rem] rounded-full bg-[#8b5cf6]/15 blur-[120px]" />
    </div>
  );
}

/** A labelled sample of the AI review every synced trade gets. */
function ExampleReview() {
  const rows: Array<{ ok: boolean; text: string }> = [
    { ok: true, text: "Entry: waited for the retest of the 4h order block" },
    { ok: true, text: "Risk: 0.8% of the account, stop beyond the swing low" },
    { ok: false, text: "Exit: closed at +0.9R, before the planned 2R target" },
  ];
  return (
    <figure
      className="landing-fade relative mt-2 max-w-[480px] rounded-2xl border border-hi/12 bg-[#0b1033]/80 p-4 sm:p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-sm"
      style={{ animationDelay: "120ms" }}
    >
      <span className="absolute -top-2.5 right-4 rounded-full border border-hi/15 bg-sheet px-2 py-0.5 text-[10px] font-medium tracking-wide text-ink-faint uppercase">
        Example
      </span>
      <figcaption className="flex items-center gap-3">
        <LogoMark className="h-9 w-9" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">AI trade review</p>
          <p className="figures text-xs text-ink-muted">BTCUSDT · Long · Binance Futures</p>
        </div>
        <span className="figures rounded-lg bg-profit/15 px-2.5 py-1 text-lg font-bold text-profit">
          B+
        </span>
      </figcaption>
      <ul className="mt-3.5 grid gap-2 text-sm">
        {rows.map((r) => (
          <li key={r.text} className="flex gap-2.5">
            <span
              className={cn(
                "mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full",
                r.ok ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss",
              )}
            >
              {r.ok ? (
                <Check className="h-3 w-3" strokeWidth={3} aria-label="Good" />
              ) : (
                <X className="h-3 w-3" strokeWidth={3} aria-label="Mistake" />
              )}
            </span>
            <span className="text-ink-muted">{r.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3.5 flex gap-2 rounded-xl bg-coach/10 px-3 py-2.5 text-sm text-ink">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-coach" aria-hidden="true" />
        <span>
          <span className="font-medium">Focus next time:</span> let winners reach the target you
          planned before the entry.
        </span>
      </p>
    </figure>
  );
}

function NextSteps() {
  return (
    <ol className="mt-2 grid max-w-[480px] gap-4 sm:grid-cols-3 sm:gap-3">
      {STEPS.map((s, i) => (
        <li
          key={s.title}
          className="landing-fade relative flex gap-3 sm:flex-col sm:gap-2.5"
          style={{ animationDelay: `${220 + i * 90}ms` }}
        >
          {i < STEPS.length - 1 && (
            <span
              aria-hidden="true"
              className="absolute top-8 -bottom-4 left-[15px] w-px bg-gradient-to-b from-coach/50 to-hi/10 sm:top-[15px] sm:right-[-0.75rem] sm:bottom-auto sm:left-10 sm:h-px sm:w-auto sm:bg-gradient-to-r"
            />
          )}
          <span
            className={cn(
              "figures relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
              i === 0
                ? "border-coach bg-coach text-coach-ink shadow-[0_0_24px_-4px_var(--color-coach)]"
                : "border-hi/20 bg-sheet text-ink-muted",
            )}
          >
            {i + 1}
          </span>
          <span className="pt-1 sm:pt-0">
            <span className="block text-sm leading-snug font-medium text-ink">{s.title}</span>
            <span className="block text-xs text-ink-faint">{s.time}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
