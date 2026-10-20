import { PAPER_DISCLAIMER, type PaperBotsPage } from "@atc/shared";
import { Panel } from "@/features/analytics/metric";
import { AutoRefresh } from "@/features/labs/backtest-views";
import { CreateBotForm } from "@/features/paper/create-form";
import { BotCard } from "@/features/paper/views";
import { apiFetch } from "@/lib/api";

export const metadata = { title: "Paper Bots" };

/**
 * Paper bots: the trader's own rules run with virtual money on live prices, to see whether they
 * hold up over weeks and different markets before any real money is involved.
 */
export default async function PaperBotsPageView() {
  const page = await apiFetch<PaperBotsPage>("/v1/paper-bots");
  return (
    <div className="grid gap-6 grid-cols-[minmax(0,1fr)]">
      <AutoRefresh every={30_000} />
      <div className="grid gap-2 rounded-[var(--radius-surface)] border border-coach/30 bg-coach/[0.06] p-4 text-sm">
        <p className="font-semibold">Test a rule with virtual money first</p>
        <p className="text-ink-muted">
          A paper bot follows your rule on live prices, pays fees, slippage and funding, and keeps
          score. It never sends an order and never touches your exchange: WickMentor stays
          read-only. Run each bot for at least 4 to 8 weeks and 30+ trades, across quiet and busy
          markets, before trusting what it shows.
        </p>
        {!page.live && (
          <p className="text-loss">
            The live price feed is not running right now: bots resume checking when it is back.
          </p>
        )}
      </div>

      {page.items.length > 0 && (
        <section aria-label="Your paper bots" className="grid gap-3 lg:grid-cols-2">
          {page.items.map((b) => (
            <BotCard key={b.id} bot={b} />
          ))}
        </section>
      )}

      <Panel title="New paper bot">
        <CreateBotForm page={page} />
      </Panel>

      <p className="text-xs text-ink-faint">{PAPER_DISCLAIMER}</p>
    </div>
  );
}
