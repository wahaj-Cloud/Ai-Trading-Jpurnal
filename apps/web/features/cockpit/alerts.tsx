"use client";

import {
  type CockpitTf,
  SCALP_ALERT_DIRECTION_LABEL,
  type ScalpAlertDto,
  type ScalpAlertsPage,
} from "@atc/shared";
import Link from "next/link";
import { useActionState, useTransition } from "react";
import { coinName } from "@/features/orderflow/format";
import { useMounted } from "@/lib/use-mounted";
import {
  type AlertActionState,
  createScalpAlertAction,
  deleteScalpAlertAction,
  toggleScalpAlertAction,
} from "./actions";

const field =
  "h-9 rounded-[var(--radius-control)] border border-rule bg-transparent px-2 text-sm text-ink";

function AlertRow({ a }: { a: ScalpAlertDto }) {
  const local = useMounted();
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] bg-hi/[0.03] px-3 py-2 text-sm">
      <span className={a.enabled ? "" : "text-ink-faint line-through"}>
        <Link href={`/cockpit?s=${a.symbol}&tf=${a.tf}`} className="font-medium hover:underline">
          {coinName(a.symbol)}
        </Link>{" "}
        · {a.minCount}+ readings {SCALP_ALERT_DIRECTION_LABEL[a.direction]} on {a.tf}
        {a.noNews ? " · quiet around news" : ""} · rests {a.cooldownMin} min · plan: stop{" "}
        {a.planStopRanges} ranges, target {a.planTargetR}R
        {a.planRiskUsd !== null ? `, risk $${a.planRiskUsd}` : ""}
        {a.lastFiredAt && (
          <span className="ml-1 text-xs text-ink-faint">
            (last{" "}
            {new Date(a.lastFiredAt).toLocaleString("en", {
              hour: "2-digit",
              minute: "2-digit",
              day: "numeric",
              month: "short",
              // The server does not know the browser's time zone: UTC until the page is live.
              ...(local ? {} : { timeZone: "UTC", timeZoneName: "short" }),
            })}
            )
          </span>
        )}
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => start(() => toggleScalpAlertAction(a.id, !a.enabled))}
          className="rounded-full border border-rule px-3 py-1 text-xs hover:bg-hi/[0.06]"
        >
          {a.enabled ? "Pause" : "Resume"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => start(() => deleteScalpAlertAction(a.id))}
          className="rounded-full border border-loss/40 px-3 py-1 text-xs text-loss hover:bg-loss/10"
        >
          Delete
        </button>
      </span>
    </li>
  );
}

/** "Tell me when …" form for the market on screen, and every saved scalp alert. */
export function ScalpAlerts({
  symbol,
  tf,
  page,
  readings,
}: {
  symbol: string;
  tf: CockpitTf;
  page: ScalpAlertsPage;
  /** Readings counted for this market now (sets the choices). */
  readings: number;
}) {
  const [state, action, pending] = useActionState<AlertActionState, FormData>(
    createScalpAlertAction,
    { status: "idle" },
  );
  const full = page.limit !== -1 && page.items.length >= page.limit;
  const max = Math.max(5, readings);
  const options = Array.from({ length: max - 2 }, (_, i) => i + 3);
  return (
    <div className="grid gap-4">
      <form action={action} className="grid gap-3">
        <input type="hidden" name="symbol" value={symbol} />
        <p className="text-sm">
          Tell me when <strong>{coinName(symbol)}</strong> has
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            name="minCount"
            defaultValue={String(Math.min(7, max))}
            className={field}
            aria-label="Readings"
          >
            {options.map((n) => (
              <option key={n} value={n}>
                {n} or more
              </option>
            ))}
          </select>
          <span>readings</span>
          <select name="direction" defaultValue="ANY" className={field} aria-label="Direction">
            <option value="ANY">either way</option>
            <option value="UP">leaning up</option>
            <option value="DOWN">leaning down</option>
          </select>
          <span>on</span>
          <select name="tf" defaultValue={tf} className={field} aria-label="Timeframe">
            <option value="5m">5m</option>
            <option value="15m">15m</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="noNews" defaultChecked className="h-4 w-4" />
            Not while a news warning is up
          </label>
          <label className="flex items-center gap-2">
            Rest
            <select name="cooldownMin" defaultValue="30" className={field}>
              {[10, 15, 30, 60, 120].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
            after each alert
          </label>
        </div>
        <fieldset className="min-w-0 grid gap-2 rounded-[var(--radius-control)] border border-rule px-3 py-2">
          <legend className="px-1 text-xs text-ink-muted">
            Trade plan sent with the alert (your rules, both sides)
          </legend>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              Stop
              <select name="planStopRanges" defaultValue="1.5" className={field}>
                {[0.5, 1, 1.5, 2, 3].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              typical 5m ranges away
            </label>
            <label className="flex items-center gap-2">
              Target
              <select name="planTargetR" defaultValue="2" className={field}>
                {[1, 1.5, 2, 3, 4].map((m) => (
                  <option key={m} value={m}>
                    {m}R
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Risk $
              <input
                name="planRiskUsd"
                type="number"
                min={1}
                max={1000000}
                step="any"
                inputMode="decimal"
                placeholder="optional"
                className={`${field} w-28`}
              />
            </label>
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending || full}
            className="h-9 rounded-full bg-coach px-4 text-sm font-semibold text-coach-ink disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save alert"}
          </button>
          {full && (
            <span className="text-xs text-ink-muted">
              Your plan keeps {page.limit} alert{page.limit === 1 ? "" : "s"}.{" "}
              <Link href="/billing" className="text-coach hover:underline">
                More on Pro
              </Link>
            </span>
          )}
          {state.message && (
            <span
              role="status"
              className={state.status === "error" ? "text-sm text-loss" : "text-sm text-profit"}
            >
              {state.message}
            </span>
          )}
        </div>
      </form>
      {page.items.length > 0 && (
        <ul className="grid gap-1.5">
          {page.items.map((a) => (
            <AlertRow key={a.id} a={a} />
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-faint">
        Checked every second while the live feed runs (every minute otherwise). An alert fires when
        its condition starts holding, then rests. It arrives in Notifications (and by email if you
        turn that on in Settings) with your plan for both sides, ready to copy. A count of readings,
        never a signal: which way, and whether to trade at all, is your call.
      </p>
    </div>
  );
}
