import {
  type ExchangeId,
  LIST_PRICE_USD,
  PLAN_DEFAULTS,
  type PlanLimits,
  type PublicPlanDto,
  UNLIMITED,
} from "@atc/shared";
import { auth } from "@clerk/nextjs/server";
import {
  ArrowRight,
  BellRing,
  Brain,
  Check,
  ChevronDown,
  FlaskConical,
  KeyRound,
  Lock,
  Menu,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { LogoMark, Wordmark } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { ExchangeMark } from "@/features/exchanges/exchange-mark";
import { BEHAVIOURS, COMPARISON, FAQ, SHOWCASE } from "@/features/landing/content";
import { LiveStrip } from "@/features/landing/live-strip";
import { BrowserFrame, Showcase } from "@/features/landing/showcase";
import { SITE_URL } from "@/features/tools/catalog";
import { serverEnv } from "@/lib/env";

export const metadata: Metadata = {
  title: { absolute: "WickMentor · The AI trading coach that shows you why you lose" },
  description:
    "AI trading journal and coach for crypto futures, forex and gold. Auto-sync Binance, MEXC, KuCoin, BingX and Exness, get every trade graded, find your costly habits, replay your rules and backtest your setups. Free plan.",
  alternates: { canonical: "/" },
};

const EXCHANGES: Array<{ id: ExchangeId; name: string; note: string }> = [
  { id: "BINANCE", name: "Binance", note: "USDⓈ-M futures" },
  { id: "MEXC", name: "MEXC", note: "Futures" },
  { id: "KUCOIN", name: "KuCoin", note: "Futures" },
  { id: "BINGX", name: "BingX", note: "Perpetuals" },
  { id: "EXNESS", name: "Exness", note: "MT4 · MT5" },
];

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#coach", label: "AI Coach" },
  { href: "#compare", label: "Why WickMentor" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

/** Public plans with prices set in Admin; falls back to the built-in limits if the API is down. */
async function loadPlans(): Promise<PublicPlanDto[]> {
  try {
    const res = await fetch(`${serverEnv().API_URL}/v1/public/plans`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const plans = (await res.json()) as PublicPlanDto[];
      if (Array.isArray(plans) && plans.length) return plans;
    }
  } catch {
    // fall through to defaults
  }
  // Mirrors the seeded plans; only used when the API cannot be reached.
  const base = {
    FREE: { exchangeAccounts: 1, aiReviewsPerMonth: 20, historyDays: 30, coachMessagesPerDay: 5 },
    PRO: { exchangeAccounts: 2, aiReviewsPerMonth: 300, historyDays: 365, coachMessagesPerDay: 50 },
    PREMIUM: {
      exchangeAccounts: 10,
      aiReviewsPerMonth: 2000,
      historyDays: UNLIMITED,
      coachMessagesPerDay: 200,
    },
  };
  return (["FREE", "PRO", "PREMIUM"] as const).map((code) => ({
    code,
    name: code === "FREE" ? "Free" : code === "PRO" ? "Pro" : "Premium",
    priceUsd: LIST_PRICE_USD[code],
    limits: { ...base[code], ...PLAN_DEFAULTS[code] } as PlanLimits,
  }));
}

const n = (v: number, unit: string, plural = `${unit}s`) =>
  v === UNLIMITED ? `Unlimited ${plural}` : `${v.toLocaleString("en")} ${v === 1 ? unit : plural}`;

function planFeatures(l: PlanLimits): string[] {
  return [
    n(l.exchangeAccounts, "exchange connection"),
    l.historyDays === UNLIMITED ? "Full trade history" : `${l.historyDays} days of history`,
    `${n(l.aiReviewsPerMonth, "AI trade review")} a month`,
    `${n(l.coachMessagesPerDay, "coach question")} a day`,
    `${n(l.setups, "setup alert")}${l.setupAlertEmail ? " (in-app + email)" : " (in-app)"}`,
    l.whatIf ? "What-If Lab" : "What-If Lab preview",
    ...(l.backtestRunsPerMonth !== 0
      ? [`Strategy Lab: ${n(l.backtestRunsPerMonth, "backtest")} a month`]
      : []),
    l.marketPulseCoins === UNLIMITED
      ? "Market Pulse: all coins, 24h/7d/30d"
      : `Market Pulse: top ${l.marketPulseCoins} coins`,
    ...(l.brokerAccounts !== 0 ? [`${n(l.brokerAccounts, "Exness account")}`] : []),
    "Live Markets and economic calendar",
  ];
}

function Section({
  id,
  eyebrow,
  title,
  sub,
  children,
  className,
}: {
  id?: string;
  eyebrow: string;
  title: ReactNode;
  sub?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`landing-reveal scroll-mt-24 py-20 sm:py-28 ${className ?? ""}`}>
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-semibold tracking-[0.18em] text-coach uppercase">{eyebrow}</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-[2.6rem] sm:leading-[1.1]">
          {title}
        </h2>
        {sub && <p className="mt-4 text-lg text-pretty text-ink-muted">{sub}</p>}
      </div>
      <div className="mt-12">{children}</div>
    </section>
  );
}

const grad =
  "bg-[linear-gradient(90deg,#7cc4ff,#4d94ff_45%,#8b5cf6)] bg-clip-text text-transparent";

export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");
  const plans = await loadPlans();

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "WickMentor",
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      url: SITE_URL,
      description: metadata.description,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];

  return (
    <div className="landing relative overflow-x-clip">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static structured data built from our own constants
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }}
      />
      <div
        className="landing-glow pointer-events-none absolute inset-x-0 top-0 h-[1100px]"
        aria-hidden="true"
      />

      {/* Navigation */}
      <header className="sticky top-0 z-40 border-b border-hi/[0.06] bg-canvas/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-8">
          <Link href="/" aria-label="WickMentor home">
            <Wordmark />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {NAV.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-full px-3 py-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
              >
                {l.label}
              </a>
            ))}
            <Link
              href="/tools"
              className="rounded-full px-3 py-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              Free tools
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <ButtonLink href="/sign-in" variant="ghost" size="sm" className="hidden sm:inline-flex">
              Sign in
            </ButtonLink>
            <ButtonLink href="/sign-up" size="sm">
              Start free
            </ButtonLink>
            <details className="group relative lg:hidden">
              <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full text-ink-muted hover:bg-hi/10 [&::-webkit-details-marker]:hidden">
                <Menu className="h-5 w-5 group-open:hidden" aria-hidden="true" />
                <X className="hidden h-5 w-5 group-open:block" aria-hidden="true" />
                <span className="sr-only">Menu</span>
              </summary>
              <nav
                aria-label="Mobile"
                className="absolute right-0 mt-2 grid w-56 gap-1 rounded-2xl border border-hi/10 bg-sheet p-2 shadow-2xl"
              >
                {NAV.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    className="rounded-xl px-3 py-2 text-sm hover:bg-hi/[0.06]"
                  >
                    {l.label}
                  </a>
                ))}
                <Link href="/tools" className="rounded-xl px-3 py-2 text-sm hover:bg-hi/[0.06]">
                  Free tools
                </Link>
                <Link href="/sign-in" className="rounded-xl px-3 py-2 text-sm hover:bg-hi/[0.06]">
                  Sign in
                </Link>
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative mx-auto max-w-7xl px-4 pt-14 pb-10 text-center sm:px-8 sm:pt-20">
          <p className="landing-fade mx-auto inline-flex items-center gap-2 rounded-full border border-coach/30 bg-coach/10 px-3.5 py-1.5 text-xs font-medium text-[#cfe3ff]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            AI trading coach for crypto futures, forex and gold
          </p>
          <h1 className="landing-fade mx-auto mt-6 max-w-5xl text-[2.6rem] leading-[1.03] font-bold tracking-[-0.035em] text-balance sm:text-6xl lg:text-7xl">
            Know exactly why you lose.
            <br />
            <span className={grad}>Fix it before your next trade.</span>
          </h1>
          <p className="landing-fade mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-ink-muted sm:text-xl">
            WickMentor syncs every trade from your exchange, grades it, spots revenge trading, FOMO
            and oversizing, and tells you the one thing to change tomorrow.
          </p>
          <div className="landing-fade mt-9 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/sign-up" size="lg" className="px-7">
              Start free, no card <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
            <ButtonLink href="#features" variant="secondary" size="lg" className="px-7">
              See it in action
            </ButtonLink>
          </div>
          <ul className="landing-fade mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-ink-muted">
            {[
              "Read-only keys",
              "Never trades or withdraws",
              "AES-256 encrypted",
              "Free plan forever",
            ].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-profit" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>

          <div className="relative mx-auto mt-14 max-w-6xl">
            <BrowserFrame src="/landing/dashboard.webp" alt="WickMentor dashboard" priority />
            {/* Floating proof cards */}
            <div className="landing-float absolute -top-6 -left-3 hidden w-72 rounded-2xl border border-hi/15 bg-sheet/95 p-4 text-left shadow-2xl backdrop-blur md:block lg:-left-10">
              <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-[#fbbf24] uppercase">
                <Brain className="h-4 w-4" aria-hidden="true" /> Pattern detected
              </p>
              <p className="mt-2 text-sm leading-snug">
                After 2 losses in a row your size jumps <b>2.1×</b>. That habit cost{" "}
                <b className="text-loss">$412</b> this month.
              </p>
            </div>
            <div className="landing-float-slow absolute -right-3 -bottom-8 hidden w-72 rounded-2xl border border-hi/15 bg-sheet/95 p-4 text-left shadow-2xl backdrop-blur md:block lg:-right-10">
              <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-coach uppercase">
                <BellRing className="h-4 w-4" aria-hidden="true" /> Your setup is forming
              </p>
              <p className="mt-2 text-sm leading-snug">
                <b>London sweep long</b> on BTCUSDT 15m: Asian low swept, bullish FVG.
              </p>
            </div>
            <p className="mt-4 text-xs text-ink-faint">
              Real app screen with demo data. Cards are illustrative.
            </p>
          </div>
        </section>

        <LiveStrip />

        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          {/* Exchanges */}
          <section aria-label="Supported exchanges" className="landing-reveal py-14 text-center">
            <p className="text-sm text-ink-muted">Connects in 60 seconds with a read-only key</p>
            <ul className="mt-6 flex flex-wrap justify-center gap-3">
              {EXCHANGES.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-3 rounded-2xl border border-hi/10 bg-hi/[0.03] px-4 py-3"
                >
                  <ExchangeMark exchange={e.id} size="md" />
                  <span className="text-left">
                    <span className="block font-semibold">{e.name}</span>
                    <span className="block text-xs text-ink-faint">{e.note}</span>
                  </span>
                </li>
              ))}
              <li className="flex items-center rounded-2xl border border-dashed border-hi/15 px-4 py-3 text-sm text-ink-muted">
                Bybit &amp; OKX next
              </li>
            </ul>
          </section>

          {/* Problem → answer */}
          <Section
            eyebrow="Not another spreadsheet"
            title={
              <>
                Most journals give you charts.
                <br />
                <span className={grad}>WickMentor gives you answers.</span>
              </>
            }
          >
            <div className="grid gap-5 md:grid-cols-3">
              {[
                {
                  icon: Brain,
                  pain: "You see your P&L, not the pattern behind it.",
                  fix: "The AI coach reads every trade and names the habit that costs you, with the exact dollar amount.",
                },
                {
                  icon: ShieldCheck,
                  pain: "You promise yourself to follow your rules.",
                  fix: "What-If Lab shows what your rules would have saved, using your real trades, so you finally believe them.",
                },
                {
                  icon: FlaskConical,
                  pain: "You trade setups you never tested.",
                  fix: "Strategy Lab backtests your setup on 2 years of candles, and Setup Alerts tell you when it forms.",
                },
              ].map((c) => (
                <div key={c.pain} className="surface rounded-3xl p-7">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-coach/15 text-coach">
                    <c.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <p className="mt-5 text-ink-faint line-through decoration-loss/60">{c.pain}</p>
                  <p className="mt-3 text-lg leading-snug font-medium">{c.fix}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* Feature tour */}
          <Section
            id="features"
            eyebrow="See it in action"
            title="Everything a serious trader needs. In one app."
            sub="Eight tools that work together: your journal feeds the coach, your setups feed the alerts and the backtests."
          >
            <Showcase items={SHOWCASE} />
          </Section>

          {/* AI coach */}
          <Section
            id="coach"
            eyebrow="AI Coach"
            title={
              <>
                Not generic advice.
                <br />
                <span className={grad}>Coaching from your own trades.</span>
              </>
            }
            sub="Our software calculates every number first; the AI explains it. So the coach can't make up statistics, and it never tells you to buy or sell."
          >
            <div className="grid items-start gap-6 lg:grid-cols-2">
              <div className="surface rounded-3xl p-7">
                <h3 className="font-semibold">Habits it detects automatically</h3>
                <ul className="mt-5 flex flex-wrap gap-2">
                  {BEHAVIOURS.map((b) => (
                    <li
                      key={b}
                      className="rounded-full border border-hi/10 bg-hi/[0.04] px-3 py-1.5 text-sm"
                    >
                      {b}
                    </li>
                  ))}
                </ul>
                <div className="mt-7 grid gap-3">
                  {[
                    [
                      "Every trade graded A to F",
                      "Entry, exit and risk, with what to do next time",
                    ],
                    ["A daily focus", "One concrete thing to change in your next session"],
                    [
                      "Weekly coaching notes",
                      "What went well, what cost money, and this week vs last",
                    ],
                    ["Ask anything", '"Why did I lose today?" "Which mistake do I repeat most?"'],
                  ].map(([t, d]) => (
                    <div key={t} className="flex gap-3">
                      <Check className="mt-1 h-4 w-4 shrink-0 text-profit" aria-hidden="true" />
                      <p>
                        <span className="font-medium">{t}</span>
                        <span className="block text-sm text-ink-muted">{d}</span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid gap-4">
                <div className="surface rounded-3xl p-6">
                  <p className="text-right">
                    <span className="inline-block rounded-2xl rounded-br-md bg-[#3a6ff7] px-4 py-2.5 text-sm font-medium text-white">
                      Why did I lose today?
                    </span>
                  </p>
                  <div className="mt-4 flex gap-3">
                    <LogoMark className="h-9 w-9" />
                    <p className="rounded-2xl rounded-bl-md bg-hi/[0.06] px-4 py-3 text-sm leading-relaxed">
                      3 of your 4 losses came <b>right after your first loss</b>, opened within 10
                      minutes and at <b>2× your normal size</b>. That is revenge trading, and it
                      cost <b className="text-loss">$318</b> today.
                      <span className="mt-2 block font-medium text-profit">
                        Tomorrow: after any loss, wait 30 minutes before the next trade.
                      </span>
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="surface rounded-3xl p-6">
                    <p className="text-xs font-semibold tracking-wide text-[#fbbf24] uppercase">
                      Costliest habit
                    </p>
                    <p className="mt-2 text-2xl font-semibold">FOMO entries</p>
                    <p className="figures mt-1 text-loss">−$1,240 · 14 trades</p>
                  </div>
                  <div className="surface rounded-3xl p-6">
                    <p className="text-xs font-semibold tracking-wide text-profit uppercase">
                      Your edge
                    </p>
                    <p className="mt-2 text-2xl font-semibold">London session</p>
                    <p className="figures mt-1 text-profit">+$2,310 · 61% win rate</p>
                  </div>
                </div>
                <p className="text-xs text-ink-faint">Illustrative example.</p>
              </div>
            </div>
          </Section>

          {/* How it works */}
          <Section eyebrow="How it works" title="From connected to coached in three minutes">
            <ol className="grid gap-5 md:grid-cols-3">
              {[
                [
                  "Connect",
                  "Paste a read-only API key, or an Exness investor password. We verify it can't trade or withdraw before saving it.",
                ],
                [
                  "Sync & review",
                  "Your full history downloads, then new trades sync every few minutes. Each one is rebuilt from fills and graded.",
                ],
                [
                  "Improve",
                  "Get a daily focus, weekly notes, alerts on your own setups and limits that warn you before a bad day gets worse.",
                ],
              ].map(([t, d], i) => (
                <li key={t} className="surface relative rounded-3xl p-7">
                  <span className={`text-5xl font-bold ${grad}`}>{i + 1}</span>
                  <h3 className="mt-3 text-xl font-semibold">{t}</h3>
                  <p className="mt-2 text-ink-muted">{d}</p>
                </li>
              ))}
            </ol>
          </Section>

          {/* Comparison */}
          <Section
            id="compare"
            eyebrow="Why WickMentor"
            title="More than a trading journal"
            sub="A typical journal records your trades. WickMentor also coaches you, tests your rules and watches the market with you."
          >
            <div className="surface mx-auto max-w-4xl overflow-hidden rounded-3xl">
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead>
                    <tr className="border-b border-hi/10 text-left">
                      <th scope="col" className="px-5 py-4 font-medium text-ink-muted">
                        Feature
                      </th>
                      <th scope="col" className="px-5 py-4 text-center font-semibold">
                        <span className="inline-flex items-center gap-2">
                          <LogoMark className="h-5 w-5" /> WickMentor
                        </span>
                      </th>
                      <th scope="col" className="px-5 py-4 text-center font-medium text-ink-muted">
                        Typical journal
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARISON.map((r) => (
                      <tr key={r.feature} className="border-b border-hi/[0.06] last:border-0">
                        <th scope="row" className="px-5 py-3.5 text-left font-normal">
                          {r.feature}
                        </th>
                        <td className="px-5 py-3.5 text-center">
                          <Check className="mx-auto h-5 w-5 text-profit" aria-label="Yes" />
                        </td>
                        <td className="px-5 py-3.5 text-center text-ink-faint">
                          {r.them === false ? (
                            <X className="mx-auto h-5 w-5 text-loss/70" aria-label="No" />
                          ) : (
                            r.them
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Section>

          {/* Security */}
          <Section
            eyebrow="Security"
            title="Your keys can't move a single dollar"
            sub="Security is built in from the first line of code, not added later."
          >
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [
                  KeyRound,
                  "Read-only by design",
                  "We test every key and refuse any that can trade or withdraw.",
                ],
                [
                  Lock,
                  "Encrypted at rest",
                  "AES-256-GCM envelope encryption with rotating master keys.",
                ],
                [
                  ShieldCheck,
                  "Never trades",
                  "WickMentor has no ability to place orders or move funds.",
                ],
                [
                  Trash2,
                  "Delete any time",
                  "Disconnecting destroys the key. Your journal stays yours.",
                ],
              ].map(([Icon, t, d]) => {
                const I = Icon as typeof Lock;
                return (
                  <div key={t as string} className="surface rounded-3xl p-6">
                    <I className="h-6 w-6 text-profit" aria-hidden="true" />
                    <h3 className="mt-4 font-semibold">{t as string}</h3>
                    <p className="mt-1.5 text-sm text-ink-muted">{d as string}</p>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* Pricing */}
          <Section
            id="pricing"
            eyebrow="Pricing"
            title="Start free. Upgrade when it pays for itself."
            sub="No card for the free plan. Paid plans are monthly and can be cancelled in one click."
          >
            <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-3">
              {plans.map((p) => {
                const featured = p.code === "PRO";
                return (
                  <div
                    key={p.code}
                    className={`relative flex flex-col rounded-3xl p-7 ${featured ? "border border-coach/50 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-coach)_14%,transparent),transparent_60%)] shadow-[0_0_0_1px_var(--color-coach)_inset,0_30px_80px_-30px_color-mix(in_srgb,var(--color-coach)_60%,transparent)]" : "surface"}`}
                  >
                    {featured && (
                      <span className="absolute -top-3 left-7 rounded-full bg-coach px-3 py-1 text-xs font-semibold text-coach-ink">
                        Most popular
                      </span>
                    )}
                    <h3 className="text-lg font-semibold">{p.name}</h3>
                    <p className="mt-3 flex items-baseline gap-1">
                      {p.code === "FREE" || p.priceUsd === 0 ? (
                        <span className="text-4xl font-bold">$0</span>
                      ) : p.priceUsd !== null ? (
                        <>
                          <span className="text-4xl font-bold">${p.priceUsd}</span>
                          <span className="text-ink-muted">/month</span>
                        </>
                      ) : (
                        <span className="text-2xl font-bold">Founding price</span>
                      )}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {p.code === "FREE"
                        ? "Everything you need to start journaling."
                        : p.code === "PRO"
                          ? "For traders building consistency, with Exness included."
                          : "For full-time traders: backtesting and more accounts."}
                    </p>
                    <ul className="mt-6 grid gap-2.5 text-sm">
                      {planFeatures(p.limits).map((f) => (
                        <li key={f} className="flex gap-2.5">
                          <Check
                            className="mt-0.5 h-4 w-4 shrink-0 text-profit"
                            aria-hidden="true"
                          />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <ButtonLink
                      href={
                        p.code === "FREE" ? "/sign-up" : `/sign-up?plan=${p.code.toLowerCase()}`
                      }
                      variant={featured ? "primary" : "secondary"}
                      className="mt-8 w-full"
                    >
                      {p.code === "FREE" ? "Start free" : `Get ${p.name}`}
                    </ButtonLink>
                  </div>
                );
              })}
            </div>
            <p className="mt-8 text-center text-sm text-ink-muted">
              <span className="font-medium text-ink">Founding members</span> keep their launch price
              for life, plus a Founding Member badge.
            </p>
          </Section>

          {/* FAQ */}
          <Section id="faq" eyebrow="FAQ" title="Questions traders ask us">
            <div className="mx-auto grid max-w-3xl gap-3">
              {FAQ.map((f) => (
                <details key={f.q} className="group surface rounded-2xl px-6 py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <ChevronDown
                      className="h-5 w-5 shrink-0 text-ink-muted transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="mt-3 leading-relaxed text-ink-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </Section>

          {/* Final CTA */}
          <section className="landing-reveal pb-24">
            <div className="relative overflow-hidden rounded-[2rem] border border-hi/10 px-6 py-16 text-center sm:px-12 sm:py-20">
              <div className="landing-glow absolute inset-0" aria-hidden="true" />
              <div className="relative">
                <LogoMark className="mx-auto h-14 w-14" />
                <h2 className="mx-auto mt-6 max-w-3xl text-3xl font-bold tracking-tight text-balance sm:text-5xl">
                  Your next 100 trades can look different.
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-lg text-ink-muted">
                  Connect your exchange, and by tomorrow you will know the habit that costs you
                  most.
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                  <ButtonLink href="/sign-up" size="lg" className="px-8">
                    Start free <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </ButtonLink>
                  <ButtonLink
                    href="/tools/trade-grader"
                    variant="secondary"
                    size="lg"
                    className="px-7"
                  >
                    Try the free trade grader
                  </ButtonLink>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-hi/[0.06]">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-8 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <Wordmark />
            <p className="mt-4 max-w-xs text-sm text-ink-muted">
              The AI trading journal and coach for crypto futures, forex and gold traders.
            </p>
          </div>
          {[
            [
              "Product",
              [
                ["#features", "Features"],
                ["#coach", "AI Coach"],
                ["#pricing", "Pricing"],
                ["#faq", "FAQ"],
              ],
            ],
            [
              "Free tools",
              [
                ["/tools", "All tools"],
                ["/tools/trade-grader", "Trade grader"],
              ],
            ],
            [
              "Legal",
              [
                ["/privacy", "Privacy"],
                ["/terms", "Terms"],
                ["/risk-disclosure", "Risk disclosure"],
              ],
            ],
          ].map(([title, links]) => (
            <div key={title as string}>
              <p className="text-sm font-semibold">{title as string}</p>
              <ul className="mt-4 grid gap-2.5 text-sm text-ink-muted">
                {(links as string[][]).map(([href, label]) => (
                  <li key={href}>
                    <Link href={href as string} className="hover:text-ink">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mx-auto max-w-7xl px-4 pb-10 text-xs leading-relaxed text-ink-faint sm:px-8">
          © {new Date().getFullYear()} WickMentor. Educational software, not financial advice.
          Trading futures and CFDs carries a high risk of losing money. Past results do not
          guarantee future results.
        </p>
      </footer>
    </div>
  );
}
