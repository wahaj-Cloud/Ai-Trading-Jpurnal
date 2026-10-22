"use client";

import {
  ZONE_ALERT_DISCLAIMER,
  ZONE_ALERT_SIDE_LABEL,
  ZONE_TF_LABEL,
  type ZoneAlertDto,
  type ZoneAlertsPage,
} from "@atc/shared";
import Link from "next/link";
import { useActionState, useTransition } from "react";
import { coinName } from "@/features/orderflow/format";
import { useMounted } from "@/lib/use-mounted";
import {
  type AlertActionState,
  createZoneAlertAction,
  deleteZoneAlertAction,
  toggleZoneAlertAction,
} from "./actions";

const field =
  "h-9 rounded-[var(--radius-control)] border border-rule bg-transparent px-2 text-sm text-ink";

function Row({ a }: { a: ZoneAlertDto }) {
  const local = useMounted();
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] bg-hi/[0.03] px-3 py-2 text-sm">
      <span className={a.enabled ? "" : "text-ink-faint line-through"}>
        <Link href={`/cockpit?s=${a.symbol}&tf=5m`} className="font-medium hover:underline">
          {coinName(a.symbol)}
        </Link>{" "}
        · {a.freshOnly ? "fresh " : ""}
        {a.tfs.map((t) => ZONE_TF_LABEL[t]).join(" and ")} {ZONE_ALERT_SIDE_LABEL[a.side]} zones ·
        rests {a.cooldownMin} min per zone
        {a.lastFiredAt && (
          <span className="ml-1 text-xs text-ink-faint">
            (last{" "}
            {new Date(a.lastFiredAt).toLocaleString("en", {
              hour: "2-digit",
              minute: "2-digit",
              day: "numeric",
              month: "short",
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
          onClick={() => start(() => toggleZoneAlertAction(a.id, !a.enabled))}
          className="rounded-full border border-rule px-3 py-1 text-xs hover:bg-hi/[0.06]"
        >
          {a.enabled ? "Pause" : "Resume"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => start(() => deleteZoneAlertAction(a.id))}
          className="rounded-full border border-loss/40 px-3 py-1 text-xs text-loss hover:bg-loss/10"
        >
          Delete
        </button>
      </span>
    </li>
  );
}

/** "Tell me when Gold reaches a fresh 4H demand zone", and every saved zone alert. */
export function ZoneAlerts({ symbol, page }: { symbol: string; page: ZoneAlertsPage }) {
  const [state, action, pending] = useActionState<AlertActionState, FormData>(
    createZoneAlertAction,
    { status: "idle" },
  );
  const full = page.limit !== -1 && page.items.length >= page.limit;
  return (
    <div className="grid gap-4">
      <form action={action} className="grid gap-3">
        <input type="hidden" name="symbol" value={symbol} />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            Tell me when <strong>{coinName(symbol)}</strong> reaches a
          </span>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="freshOnly" defaultChecked className="h-4 w-4" />
            fresh
          </label>
          <select name="side" defaultValue="ANY" className={field} aria-label="Zone side">
            <option value="ANY">supply or demand</option>
            <option value="DEMAND">demand</option>
            <option value="SUPPLY">supply</option>
          </select>
          <span>zone on</span>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="tfs" value="1h" defaultChecked className="h-4 w-4" />
            1H
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="tfs" value="4h" defaultChecked className="h-4 w-4" />
            4H
          </label>
        </div>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Quiet for
          <select name="cooldownMin" defaultValue="120" className={field}>
            {[30, 60, 120, 240, 720].map((m) => (
              <option key={m} value={m}>
                {m >= 60 ? `${m / 60} h` : `${m} min`}
              </option>
            ))}
          </select>
          before the same zone can alert again
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending || full}
            className="h-9 rounded-full bg-coach px-4 text-sm font-semibold text-coach-ink disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save zone alert"}
          </button>
          {full && (
            <span className="text-xs text-ink-muted">
              Your plan keeps {page.limit} zone alert{page.limit === 1 ? "" : "s"}.{" "}
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
            <Row key={a.id} a={a} />
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-faint">
        Checked every second on the live price. It alerts when the price arrives inside a zone
        (fresh = the first return since the zone formed), with the zone's range. Zones come from
        closed 1H and 4H candles. {ZONE_ALERT_DISCLAIMER}
      </p>
    </div>
  );
}
