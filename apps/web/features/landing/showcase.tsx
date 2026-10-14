"use client";

import { Check } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/cn";

export interface ShowcaseItem {
  id: string;
  tab: string;
  title: string;
  body: string;
  points: string[];
  image: string;
  plan?: string;
}

/** Tabbed tour of the real app: one screen per feature, switchable without leaving the page. */
export function Showcase({ items }: { items: ShowcaseItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const cur = items.find((i) => i.id === active) ?? items[0];
  if (!cur) return null;
  return (
    <div className="grid gap-8">
      <div
        role="tablist"
        aria-label="Features"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:justify-center sm:px-0"
      >
        {items.map((i) => (
          <button
            key={i.id}
            type="button"
            role="tab"
            id={`tab-${i.id}`}
            aria-selected={i.id === cur.id}
            aria-controls={`panel-${i.id}`}
            onClick={() => setActive(i.id)}
            className={cn(
              "h-10 shrink-0 rounded-full border px-4 text-sm whitespace-nowrap transition-colors",
              i.id === cur.id
                ? "border-coach/60 bg-coach/15 font-medium text-ink shadow-[0_0_0_1px_var(--color-coach)_inset]"
                : "border-rule text-ink-muted hover:bg-hi/[0.06] hover:text-ink",
            )}
          >
            {i.tab}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`panel-${cur.id}`}
        aria-labelledby={`tab-${cur.id}`}
        className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]"
      >
        <div key={cur.id} className="landing-fade">
          {cur.plan && (
            <span className="mb-3 inline-block rounded-full bg-hi/10 px-2.5 py-0.5 text-xs text-ink-muted">
              {cur.plan}
            </span>
          )}
          <h3 className="text-2xl font-semibold tracking-tight sm:text-3xl">{cur.title}</h3>
          <p className="mt-3 leading-relaxed text-ink-muted">{cur.body}</p>
          <ul className="mt-5 grid gap-2.5">
            {cur.points.map((p) => (
              <li key={p} className="flex gap-2.5 text-sm">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-profit" aria-hidden="true" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <BrowserFrame
          key={`img-${cur.id}`}
          src={cur.image}
          alt={`${cur.tab} screen in WickMentor`}
        />
      </div>
      <p className="text-center text-xs text-ink-faint">
        Real WickMentor screens, shown with demo data.
      </p>
    </div>
  );
}

export function BrowserFrame({
  src,
  alt,
  priority = false,
  className,
}: {
  src: string;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <figure
      className={cn(
        "landing-fade overflow-hidden rounded-2xl border border-hi/15 bg-[#070b22] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.04)_inset]",
        className,
      )}
    >
      <div className="flex h-8 items-center gap-1.5 border-b border-hi/10 px-3" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="mx-auto rounded-md bg-hi/[0.06] px-3 py-0.5 text-[11px] text-ink-faint">
          wickmentor.com
        </span>
      </div>
      <Image
        src={src}
        alt={alt}
        width={1600}
        height={1000}
        priority={priority}
        sizes="(min-width: 1024px) 760px, 100vw"
        className="block h-auto w-full"
      />
    </figure>
  );
}
