import { EXCHANGE_CATALOG, EXCHANGE_IDS } from "@atc/shared";
import { PlugZap } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { ConnectionList } from "@/features/exchanges/connection-list";
import { getExchangeAccounts } from "@/features/exchanges/load";
import { parseIds } from "@/features/exchanges/queue";
import { getMe } from "@/lib/me";

export const metadata = { title: "Exchanges" };

const andList = new Intl.ListFormat("en", { style: "long", type: "conjunction" });
const orList = new Intl.ListFormat("en", { style: "long", type: "disjunction" });

export default async function ExchangesPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; updated?: string }>;
}) {
  const [{ accounts, limit, brokers }, me, params] = await Promise.all([
    getExchangeAccounts(),
    getMe(),
    searchParams,
  ]);
  const isFull = (l: { used: number; max: number }) => l.max !== -1 && l.used >= l.max;
  // Exness has its own allowance, so there may be room for it even when crypto slots are full.
  const atLimit = isFull(limit) && (brokers.max === 0 || isFull(brokers));
  const connected = parseIds(params.connected).map((id) => EXCHANGE_CATALOG[id].name);
  const notice =
    connected.length > 0
      ? `${andList.format(connected)} connected. ${connected.length > 1 ? "Each key is" : "Your key is"} verified as read-only.`
      : params.updated
        ? "Key replaced and verified."
        : null;
  const exchangeNames = orList.format(EXCHANGE_IDS.map((id) => EXCHANGE_CATALOG[id].name));

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Exchanges</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {limit.max === -1
              ? `${limit.used} exchange${limit.used === 1 ? "" : "s"} connected`
              : `${limit.used} of ${limit.max} exchange connections used`}
            {brokers.max !== 0 &&
              (brokers.max === -1
                ? ` · ${brokers.used} Exness`
                : ` · ${brokers.used} of ${brokers.max} Exness`)}
            {` on the ${me.plan.name} plan`}
          </p>
        </div>
        {!atLimit && accounts.length > 0 && (
          <ButtonLink href="/exchanges/connect">Connect exchanges</ButtonLink>
        )}
      </header>

      {notice && (
        <p
          role="status"
          className="rounded-[var(--radius-control)] border border-rule bg-raised px-4 py-3 text-sm"
        >
          {notice}
        </p>
      )}

      {accounts.length === 0 ? (
        <section className="rounded-[var(--radius-surface)] surface p-8 text-center">
          <PlugZap className="mx-auto h-6 w-6 text-coach" aria-hidden="true" />
          <h2 className="mt-3 font-semibold">Connect your exchanges</h2>
          <p className="mx-auto mt-2 max-w-[50ch] text-sm text-ink-muted">
            Connect {exchangeNames} read-only: an API key for crypto exchanges, an investor password
            for MetaTrader brokers. We can see your trades, but can never place orders or move
            funds.
          </p>
          <ButtonLink href="/exchanges/connect" className="mt-6">
            Choose exchanges
          </ButtonLink>
        </section>
      ) : (
        <ConnectionList accounts={accounts} timezone={me.timezone} />
      )}

      {atLimit && (
        <p className="text-sm text-ink-muted">
          You have used all connections on your plan. Disconnect one to add another. More plans
          arrive with billing.
        </p>
      )}
      <p className="text-sm text-ink-faint">Bitget and Hyperliquid will follow.</p>
    </div>
  );
}
