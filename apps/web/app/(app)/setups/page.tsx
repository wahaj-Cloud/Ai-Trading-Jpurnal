import {
  describeCondition,
  SETUP_ALERT_DISCLAIMER,
  type SetupAlertsPage,
  type SetupsListDto,
} from "@atc/shared";
import { BellRing, Plus } from "lucide-react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/features/analytics/metric";
import { DismissAlert, SetupControls } from "@/features/setups/controls";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getMe } from "@/lib/me";

export const metadata = { title: "My Setup Alerts" };

const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

/** My Setup Alerts: the trader's own setups and the alerts they produced. Never buy/sell calls. */
export default async function SetupsPage({
  searchParams,
}: {
  searchParams: Promise<{ alert?: string }>;
}) {
  const [{ alert }, list, alerts, me] = await Promise.all([
    searchParams,
    apiFetch<SetupsListDto>("/v1/setups"),
    apiFetch<SetupAlertsPage>("/v1/setup-alerts?limit=30"),
    getMe(),
  ]);
  const now = Date.now();
  const atLimit = list.limit !== -1 && list.items.length >= list.limit;
  const tz = me.timezone;
  const when = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: tz,
  });
  return (
    <div className="mx-auto grid max-w-6xl gap-6 grid-cols-[minmax(0,1fr)]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Setup Alerts</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Save your own setup once and get told when it forms on a closed candle. Your journal
            then shows which trades were planned and which had no setup, and the coach compares the
            two. These are your rules, not trading signals.
          </p>
        </div>
        {atLimit ? (
          <ButtonLink href="/billing" variant="secondary">
            Upgrade for more setups
          </ButtonLink>
        ) : (
          <ButtonLink href="/setups/new">
            <Plus className="h-4 w-4" aria-hidden="true" /> New setup
          </ButtonLink>
        )}
      </header>

      <Panel
        title="Your setups"
        action={
          <span className="text-xs text-ink-faint">
            {list.limit === -1
              ? `${list.items.length} saved`
              : `${list.items.length} of ${list.limit}`}
            {" · "}
            {list.emailAlerts ? "in-app + email alerts" : "in-app alerts (email on Pro)"}
          </span>
        }
      >
        {list.items.length ? (
          <ul className="grid gap-3">
            {list.items.map((s) => (
              <li
                key={s.id}
                className={cn(
                  "grid gap-2 rounded-[var(--radius-control)] border border-rule p-4 sm:grid-cols-[1fr_auto] sm:items-center",
                  !s.isActive && "opacity-60",
                )}
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <Link href={`/setups/${s.id}`} className="underline-offset-4 hover:underline">
                      {s.name}
                    </Link>
                    <span className="rounded-full bg-hi/10 px-2 text-xs text-ink-muted">
                      {s.rule.direction} · {s.timeframe}
                    </span>
                    {!s.isActive && <span className="text-xs text-ink-faint">paused</span>}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">{s.symbols.join(", ")}</p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {s.rule.all.map(describeCondition).join(" · ")}
                  </p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {s.alerts30d} alert{s.alerts30d === 1 ? "" : "s"} in 30 days
                    {s.lastAlertAt ? ` · last ${ago(s.lastAlertAt, now)}` : ""}
                  </p>
                </div>
                <SetupControls id={s.id} active={s.isActive} name={s.name} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid justify-items-start gap-3 text-sm text-ink-muted">
            <p>
              No setups yet. Describe the setup you already trade — for example "Asian low swept,
              then a bullish fair value gap in London" — and preview it on recent candles before
              saving.
            </p>
            <ButtonLink href="/setups/new" size="sm">
              Build your first setup
            </ButtonLink>
          </div>
        )}
      </Panel>

      <Panel title="Recent alerts">
        {alerts.items.length ? (
          <ul className="grid gap-2">
            {alerts.items.map((a) => (
              <li
                key={a.id}
                id={`alert-${a.id}`}
                className={cn(
                  "flex items-start gap-3 rounded-[var(--radius-control)] border p-3",
                  alert === a.id ? "border-coach/60 bg-coach/10" : "border-rule",
                  a.dismissed && "opacity-60",
                )}
              >
                <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-coach" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{a.setupName}</span> formed on{" "}
                    <span className="font-medium">
                      {a.symbol} {a.timeframe}
                    </span>{" "}
                    <span className="text-ink-faint">
                      · {when.format(new Date(a.candleCloseAt))}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">{a.matched.join(" · ")}</p>
                  {a.positionId && (
                    <Link
                      href={`/trades/${a.positionId}`}
                      className="mt-1 inline-block text-xs text-coach underline-offset-4 hover:underline"
                    >
                      You traded it → view the trade
                    </Link>
                  )}
                </div>
                {!a.dismissed && <DismissAlert id={a.id} />}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">
            No alerts yet. They appear here and in your notifications.
          </p>
        )}
      </Panel>
      <p className="text-xs text-ink-faint">{SETUP_ALERT_DISCLAIMER}</p>
    </div>
  );
}
