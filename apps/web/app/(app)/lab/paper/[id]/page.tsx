import { PAPER_DISCLAIMER, type PaperBotDetailDto, signedUsd } from "@atc/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Panel } from "@/features/analytics/metric";
import { LineChart } from "@/features/charts/line-chart";
import { AutoRefresh } from "@/features/labs/backtest-views";
import { coinName } from "@/features/orderflow/format";
import { BotControls } from "@/features/paper/controls";
import {
  Breakdown,
  MaturityBanner,
  OpenTrade,
  ruleText,
  StatsGrid,
  TradesTable,
} from "@/features/paper/views";
import { ApiError, apiFetch } from "@/lib/api";

export const metadata = { title: "Paper bot" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaperBotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const bot = await apiFetch<PaperBotDetailDto>(`/v1/paper-bots/${id}`).catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  });
  const s = bot.stats;
  return (
    <div className="grid gap-6 grid-cols-[minmax(0,1fr)]">
      <AutoRefresh every={15_000} />
      <header className="grid gap-2">
        <Link href="/lab/paper" className="text-sm text-ink-muted hover:text-ink">
          ← Paper bots
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold">
            {bot.name}{" "}
            <span className="text-sm font-normal text-ink-muted">
              · {coinName(bot.symbol)} · {bot.enabled ? "running" : "paused"} · virtual money
            </span>
          </h2>
          <BotControls id={bot.id} enabled={bot.enabled} hasOpen={bot.open !== null} />
        </div>
        <p className="text-xs text-ink-faint">{ruleText(bot)}</p>
      </header>

      <MaturityBanner bot={bot} />

      {bot.open && (
        <Panel title="Open trade">
          <OpenTrade t={bot.open} />
          <p className="mt-2 text-xs text-ink-faint">
            Checked every second on the live price: stop, target, then the time limit. Funding is
            charged at 00:00, 08:00 and 16:00 UTC.
          </p>
        </Panel>
      )}

      <StatsGrid s={s} startEquity={bot.startEquity} />

      <Panel title="Virtual balance after each trade">
        {bot.curve.length > 1 ? (
          <LineChart
            label="Virtual balance after each closed trade"
            format="usd"
            series={[
              {
                name: "Balance (USD)",
                colorVar: "--color-coach",
                fallback: "#7c8cff",
                points: bot.curve.map((p) => ({
                  t: Math.floor(Date.parse(p.at) / 1000),
                  v: p.equity,
                })),
              },
            ]}
          />
        ) : (
          <p className="text-sm text-ink-muted">The line starts with the first closed trade.</p>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="By session">
          <Breakdown title="When it entered" rows={bot.bySession} />
          {bot.bySession.length === 0 && <p className="text-sm text-ink-muted">No trades yet.</p>}
        </Panel>
        <Panel title="By side and exit">
          <div className="grid gap-4">
            <Breakdown title="Side" rows={bot.bySide} />
            <Breakdown title="Why it closed" rows={bot.byExit} />
            {bot.bySide.length === 0 && <p className="text-sm text-ink-muted">No trades yet.</p>}
          </div>
        </Panel>
        <Panel title="Your real trades, same market">
          {bot.real ? (
            <div className="figures grid gap-1 text-sm">
              <p>
                Since this run started you closed {bot.real.trades} trade
                {bot.real.trades === 1 ? "" : "s"} on {coinName(bot.symbol)}: win rate{" "}
                {bot.real.winRatePct === null ? "—" : `${Math.round(bot.real.winRatePct)}%`},{" "}
                <span className={bot.real.netPnl >= 0 ? "text-profit" : "text-loss"}>
                  {signedUsd(bot.real.netPnl)}
                </span>
                .
              </p>
              <p className="text-xs text-ink-faint">
                The bot's balance and yours differ in size, so compare win rates and the direction
                of the result, not the dollars.
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              No real trades closed on {coinName(bot.symbol)} since this run started.
            </p>
          )}
        </Panel>
      </div>

      <Panel title="Trades">
        <TradesTable trades={bot.trades} />
      </Panel>

      <p className="text-xs text-ink-faint">{PAPER_DISCLAIMER}</p>
    </div>
  );
}
