import { EXCHANGE_CATALOG } from "@atc/shared";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connectExchangeAction } from "@/features/exchanges/actions";
import { ExchangeMark } from "@/features/exchanges/exchange-mark";
import { KeyForm } from "@/features/exchanges/key-form";
import { KeyGuide } from "@/features/exchanges/key-guides";
import { getExchangeAccounts } from "@/features/exchanges/load";
import { afterCurrent, buildQueue, finishHref, slugToExchange } from "@/features/exchanges/queue";

type Params = Promise<{ exchange: string }>;
type Search = Promise<{ q?: string; done?: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const exchange = slugToExchange((await params).exchange);
  return { title: exchange ? `Connect ${EXCHANGE_CATALOG[exchange].name}` : "Connect exchange" };
}

export default async function ConnectExchangePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const [{ exchange: slug }, search, { egressIps, limit, brokers }] = await Promise.all([
    params,
    searchParams,
    getExchangeAccounts(),
  ]);
  const exchange = slugToExchange(slug);
  if (!exchange) notFound();

  const queue = buildQueue(exchange, search.q, search.done);
  // Plan full mid-queue (or on arrival): finish with what was connected instead of showing a dead form.
  const info = EXCHANGE_CATALOG[exchange];
  // Exness has its own allowance; crypto exchanges share the plan's connection limit.
  const cap = info.kind === "METATRADER" ? brokers : limit;
  if (cap.max !== -1 && cap.used >= cap.max) redirect(finishHref(queue.done));

  const step = queue.order.indexOf(exchange) + 1;
  const total = queue.order.length;
  const action = connectExchangeAction.bind(null, exchange, { q: search.q, done: search.done });

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/exchanges" className="text-sm text-ink-muted hover:text-ink">
          Exchanges
        </Link>
        {total > 1 && (
          <p className="figures text-sm text-ink-muted">
            Exchange {step} of {total}
          </p>
        )}
      </div>
      {total > 1 && (
        <ol className="mt-3 flex gap-1.5" aria-label="Exchanges to connect">
          {queue.order.map((id, i) => (
            <li
              key={id}
              aria-current={id === exchange ? "step" : undefined}
              className={`h-1 flex-1 rounded-full ${
                queue.done.includes(id)
                  ? "bg-profit"
                  : id === exchange
                    ? "bg-coach"
                    : i < step
                      ? "bg-ink-faint"
                      : "bg-rule"
              }`}
            >
              <span className="sr-only">
                {EXCHANGE_CATALOG[id].name}
                {queue.done.includes(id) ? ", connected" : id === exchange ? ", current" : ""}
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
          <ExchangeMark exchange={exchange} size="lg" />
          Connect {info.name} {info.product}
        </h1>
        {total > 1 && (
          <Link href={afterCurrent(queue, false)} className="text-sm text-ink-muted hover:text-ink">
            {step < total ? `Skip ${info.name}` : `Skip ${info.name} and finish`}
          </Link>
        )}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <section
          aria-labelledby="guide-heading"
          className="rounded-[var(--radius-surface)] surface p-5 sm:p-6"
        >
          <h2 id="guide-heading" className="mb-5 font-semibold">
            {info.kind === "METATRADER"
              ? `Get your read-only login for ${info.name}`
              : `Create a read-only key on ${info.name}`}
          </h2>
          <KeyGuide exchange={exchange} egressIps={egressIps} />
        </section>
        <section
          aria-labelledby="form-heading"
          className="rounded-[var(--radius-surface)] surface p-5 sm:p-6"
        >
          <h2 id="form-heading" className="mb-5 font-semibold">
            {info.kind === "METATRADER" ? "Enter your MetaTrader login" : "Paste your key"}
          </h2>
          <KeyForm
            key={exchange}
            exchange={exchange}
            action={action}
            defaultLabel={info.name}
            submitLabel={
              step < total ? `Connect ${info.name} and continue` : `Connect ${info.name}`
            }
          />
        </section>
      </div>
    </div>
  );
}
