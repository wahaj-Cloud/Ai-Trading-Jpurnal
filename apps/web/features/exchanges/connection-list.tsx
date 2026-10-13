import { EXCHANGE_CATALOG, type ExchangeAccountDto } from "@atc/shared";
import { Clock, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { DisconnectButton } from "./disconnect-button";
import { ExchangeMark } from "./exchange-mark";
import { SyncNowButton } from "./sync-now-button";

const STATUS: Record<ExchangeAccountDto["status"], { text: string; dot: string }> = {
  CONNECTING: { text: "Connecting", dot: "bg-coach" },
  ACTIVE: { text: "Connected", dot: "bg-profit" },
  INVALID: { text: "Key no longer works", dot: "bg-loss" },
  DISCONNECTED: { text: "Disconnected", dot: "bg-ink-faint" },
};

const DAY_MS = 86_400_000;
const EXPIRY_WARNING_DAYS = 14;

export function ConnectionList({
  accounts,
  timezone,
}: {
  accounts: ExchangeAccountDto[];
  timezone: string;
}) {
  const date = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: timezone });
  const now = Date.now();

  return (
    <ul className="divide-y divide-rule rounded-[var(--radius-surface)] surface">
      {accounts.map((a) => {
        const info = EXCHANGE_CATALOG[a.exchange];
        const status = STATUS[a.status];
        const inactive = a.status === "DISCONNECTED";
        const metatrader = info.kind === "METATRADER";
        const expiresInDays = a.keyExpiresAt
          ? Math.ceil((new Date(a.keyExpiresAt).getTime() - now) / DAY_MS)
          : null;
        return (
          <li key={a.id} className="grid gap-4 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-start">
            <ExchangeMark
              exchange={a.exchange}
              className={cn("hidden sm:flex", inactive && "opacity-50")}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className={cn("font-medium", inactive && "text-ink-muted")}>{a.label}</h2>
                <span className="flex items-center gap-1.5 text-sm text-ink-muted">
                  <span className={cn("h-2 w-2 rounded-full", status.dot)} aria-hidden="true" />
                  {metatrader && a.status === "INVALID" ? "Needs reconnecting" : status.text}
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                {info.name} {info.product}, {metatrader ? "account" : "key"} ending{" "}
                <span className="font-mono text-ink">{a.apiKeyHint}</span>
              </p>
              {!inactive && <IpLine exchangeName={info.name} ipRestricted={a.ipRestricted} />}
              {!inactive && expiresInDays !== null && (
                <p
                  className={cn(
                    "mt-2 flex items-center gap-1.5 text-sm",
                    expiresInDays <= EXPIRY_WARNING_DAYS ? "text-coach" : "text-ink-muted",
                  )}
                >
                  <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {expiresInDays <= 0
                    ? `${info.name} has expired this key. Replace it to keep syncing.`
                    : `${info.name} expires this key on ${date.format(new Date(a.keyExpiresAt ?? now))}${
                        expiresInDays <= EXPIRY_WARNING_DAYS
                          ? `, in ${expiresInDays} day${expiresInDays === 1 ? "" : "s"}`
                          : ""
                      }.`}
                </p>
              )}
              {a.lastError && <p className="mt-2 text-sm text-loss">{a.lastError}</p>}
              {a.status === "ACTIVE" && <SyncLine sync={a.sync} date={date} now={now} />}
              {a.status === "CONNECTING" && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-muted" role="status">
                  <RefreshCw
                    className="h-4 w-4 shrink-0 animate-spin text-coach"
                    aria-hidden="true"
                  />
                  Logging in to your MetaTrader account read-only. This takes a few minutes; refresh
                  the page to see progress.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <ButtonLink href={`/exchanges/${a.id}/reconnect`} variant="secondary" size="sm">
                {inactive ? "Reconnect" : metatrader ? "Update password" : "Replace key"}
              </ButtonLink>
              {a.status === "ACTIVE" && (
                <SyncNowButton accountId={a.id} busy={a.sync.state !== "IDLE"} />
              )}
              {!inactive && <DisconnectButton accountId={a.id} label={a.label} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function IpLine({
  exchangeName,
  ipRestricted,
}: {
  exchangeName: string;
  ipRestricted: boolean | null;
}) {
  // Unknown (the exchange does not report it): say nothing rather than guess.
  if (ipRestricted === null) return null;
  return (
    <p className="mt-2 flex items-center gap-1.5 text-sm">
      {ipRestricted ? (
        <>
          <ShieldCheck className="h-4 w-4 shrink-0 text-profit" aria-hidden="true" />
          <span className="text-ink-muted">Locked to trusted IP addresses</span>
        </>
      ) : (
        <>
          <ShieldAlert className="h-4 w-4 shrink-0 text-coach" aria-hidden="true" />
          <span className="text-ink-muted">
            Not IP-restricted. Adding our IPs on {exchangeName} makes a leaked key useless.
          </span>
        </>
      )}
    </p>
  );
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function ago(iso: string, now: number): string {
  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

function SyncLine({
  sync,
  date,
  now,
}: {
  sync: ExchangeAccountDto["sync"];
  date: Intl.DateTimeFormat;
  now: number;
}) {
  if (sync.state !== "IDLE") {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-muted" role="status">
        <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-coach" aria-hidden="true" />
        {sync.state === "PENDING"
          ? "Importing your trade history. The first import takes a few minutes."
          : "Syncing now."}
      </p>
    );
  }
  return (
    <p className="mt-2 text-xs text-ink-faint">
      {sync.lastSyncedAt ? `Synced ${ago(sync.lastSyncedAt, now)}` : "Not synced yet"}
      {sync.historyStartsAt
        ? `. Trades from ${date.format(new Date(sync.historyStartsAt))} onwards.`
        : "."}
    </p>
  );
}
