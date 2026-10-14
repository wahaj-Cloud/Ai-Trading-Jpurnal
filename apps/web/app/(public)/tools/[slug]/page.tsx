import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PUBLIC_TOOLS, SITE_URL, toolBySlug } from "@/features/tools/catalog";
import { ToolView } from "@/features/tools/tool-view";
import { SignupCta } from "../cta";

type Params = Promise<{ slug: string }>;

export const dynamicParams = false;
export function generateStaticParams() {
  return PUBLIC_TOOLS.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const tool = toolBySlug((await params).slug);
  if (!tool) return {};
  const url = `${SITE_URL}/tools/${tool.slug}`;
  return {
    title: { absolute: `${tool.title} | WickMentor` },
    description: tool.description,
    alternates: { canonical: url },
    openGraph: { title: tool.title, description: tool.description, url, type: "website" },
  };
}

/** One free tool: the calculator, how it works, FAQ (also as structured data), then sign-up. */
export default async function ToolPage({ params }: { params: Params }) {
  const tool = toolBySlug((await params).slug);
  if (!tool) notFound();
  const others = PUBLIC_TOOLS.filter((t) => t.slug !== tool.slug).slice(0, 6);
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: tool.name,
      url: `${SITE_URL}/tools/${tool.slug}`,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Any",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      description: tool.description,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: tool.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];

  return (
    <div className="grid gap-10 pt-4">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from our own catalog
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <header className="max-w-3xl">
        <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
          <Link href="/tools" className="hover:text-ink">
            Free tools
          </Link>{" "}
          / {tool.name}
        </nav>
        <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          {tool.title}
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-muted">{tool.intro}</p>
      </header>

      <ToolView slug={tool.slug} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface rounded-[var(--radius-surface)] p-6">
          <h2 className="font-semibold">How it works</h2>
          <ul className="mt-3 grid list-disc gap-2 pl-5 text-sm leading-relaxed text-ink-muted">
            {tool.howItWorks.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </section>
        <section className="surface rounded-[var(--radius-surface)] p-6">
          <h2 className="font-semibold">Questions</h2>
          <dl className="mt-3 grid gap-4 text-sm leading-relaxed">
            {tool.faq.map((f) => (
              <div key={f.q}>
                <dt className="font-medium">{f.q}</dt>
                <dd className="mt-1 text-ink-muted">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <SignupCta />

      <section aria-labelledby="more-tools">
        <h2 id="more-tools" className="font-semibold">
          More free tools
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {others.map((t) => (
            <li key={t.slug}>
              <Link
                href={`/tools/${t.slug}`}
                className="inline-block rounded-full border border-rule px-3 py-1.5 text-sm text-ink-muted hover:border-coach/60 hover:text-ink"
              >
                {t.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
