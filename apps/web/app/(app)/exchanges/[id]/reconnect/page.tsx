import { EXCHANGE_CATALOG } from "@atc/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { replaceKeyAction } from "@/features/exchanges/actions";
import { ExchangeMark } from "@/features/exchanges/exchange-mark";
import { KeyForm } from "@/features/exchanges/key-form";
import { KeyGuide } from "@/features/exchanges/key-guides";
import { getExchangeAccounts } from "@/features/exchanges/load";

export const metadata = { title: "Replace key" };

export default async function ReconnectPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, { accounts, egressIps }] = await Promise.all([params, getExchangeAccounts()]);
  const account = accounts.find((a) => a.id === id);
  if (!account) notFound();
  const info = EXCHANGE_CATALOG[account.exchange];

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/exchanges" className="text-sm text-ink-muted hover:text-ink">
        Exchanges
      </Link>
      <h1 className="mt-2 flex items-center gap-3 text-2xl font-semibold tracking-tight">
        <ExchangeMark exchange={account.exchange} size="lg" />
        {info.kind === "METATRADER" ? "Connect again:" : "New key for"} {account.label}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {info.kind === "METATRADER"
          ? `Use the same ${info.name} account number and server, with its current investor (read-only) password.`
          : `The new key must belong to the same ${info.name} account, so your history stays accurate.`}
      </p>
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <section className="rounded-[var(--radius-surface)] surface p-5 sm:p-6">
          <KeyGuide exchange={account.exchange} egressIps={egressIps} />
        </section>
        <section className="rounded-[var(--radius-surface)] surface p-5 sm:p-6">
          <KeyForm
            exchange={account.exchange}
            action={replaceKeyAction.bind(null, account.id, account.exchange)}
            submitLabel={info.kind === "METATRADER" ? "Connect again" : "Verify and save key"}
          />
        </section>
      </div>
    </div>
  );
}
