import type { ExchangeId } from "@atc/shared";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExchangePicker } from "@/features/exchanges/exchange-picker";
import { getExchangeAccounts } from "@/features/exchanges/load";
import { getMe } from "@/lib/me";

export const metadata = { title: "Connect exchanges" };

export default async function ConnectPickerPage() {
  const [{ accounts, limit }, me] = await Promise.all([getExchangeAccounts(), getMe()]);
  const slotsLeft = limit.max === -1 ? -1 : Math.max(limit.max - limit.used, 0);
  if (slotsLeft === 0) redirect("/exchanges");

  const connectedCounts: Partial<Record<ExchangeId, number>> = {};
  for (const a of accounts) {
    if (a.status !== "DISCONNECTED")
      connectedCounts[a.exchange] = (connectedCounts[a.exchange] ?? 0) + 1;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/exchanges" className="text-sm text-ink-muted hover:text-ink">
        Exchanges
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Which exchanges do you trade futures on?
      </h1>
      <p className="mt-2 max-w-[60ch] text-sm text-ink-muted">
        Pick one or several. For each, we show you how to create a read-only key, check it, and move
        on to the next. You can connect more than one account on the same exchange later.
      </p>
      <div className="mt-8">
        <ExchangePicker
          connectedCounts={connectedCounts}
          slotsLeft={slotsLeft}
          brokerSlotsLeft={
            me.plan.limits.brokerAccounts === -1
              ? -1
              : Math.max(me.plan.limits.brokerAccounts - (connectedCounts.EXNESS ?? 0), 0)
          }
        />
      </div>
    </div>
  );
}
