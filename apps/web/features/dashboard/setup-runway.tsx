import type { MeResponse } from "@atc/shared";
import { Check } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";

interface Step {
  title: string;
  body: string;
  done: boolean;
}

/** A genuine sequence, so it is numbered. The first unfinished step is the one we highlight. */
export function SetupRunway({ onboarding }: { onboarding: MeResponse["onboarding"] }) {
  const steps: Step[] = [
    {
      title: "Connect an exchange",
      body: "Add read-only API keys from Binance, MEXC, KuCoin or BingX. We reject keys that can trade or withdraw.",
      done: onboarding.exchangeConnected,
    },
    {
      title: "Import your history",
      body: "We rebuild every position from your fills, fees and funding payments.",
      done: onboarding.firstSyncCompleted,
    },
    {
      title: "Review your first trade",
      body: "Open a trade, rate it and note your emotions and mistakes. Your coach learns from every review.",
      done: onboarding.firstTradeReviewed,
    },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <section
      aria-labelledby="setup-heading"
      className="rounded-[var(--radius-surface)] border border-rule bg-panel p-5 sm:p-6"
    >
      <h2 id="setup-heading" className="font-semibold">
        Get started
      </h2>
      <ol className="mt-5 grid gap-5 md:grid-cols-3 md:gap-0">
        {steps.map((step, i) => {
          const isCurrent = i === current;
          return (
            <li key={step.title} className="relative md:pr-6">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "figures flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm",
                    step.done && "border-profit bg-profit/15 text-profit",
                    isCurrent && "border-coach bg-coach text-coach-ink",
                    !step.done && !isCurrent && "border-rule text-ink-faint",
                  )}
                >
                  {step.done ? <Check className="h-4 w-4" aria-label="Done" /> : i + 1}
                </span>
                {i < steps.length - 1 && (
                  <span className="hidden h-px flex-1 bg-rule md:block" aria-hidden="true" />
                )}
              </div>
              <h3
                className={cn(
                  "mt-3 text-sm font-medium",
                  !isCurrent && !step.done && "text-ink-muted",
                )}
              >
                {step.title}
              </h3>
              <p className="mt-1 max-w-[34ch] text-sm text-ink-muted">{step.body}</p>
              {isCurrent && i === 0 && (
                <ButtonLink href="/exchanges/connect" size="sm" className="mt-3">
                  Connect exchanges
                </ButtonLink>
              )}
              {isCurrent && i === 1 && (
                <p className="mt-3 text-sm text-coach" role="status">
                  Importing your last three months of trades. This takes a few minutes.
                </p>
              )}
              {isCurrent && i === 2 && (
                <ButtonLink href="/trades" size="sm" className="mt-3">
                  Pick a trade to review
                </ButtonLink>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
