"use client";

import { useState, useTransition } from "react";
import {
  closePaperTradeAction,
  deletePaperBotAction,
  resetPaperBotAction,
  togglePaperBotAction,
} from "./actions";

const btn = "rounded-full border px-3 py-1.5 text-xs disabled:opacity-50";

/** Pause or resume, close the open trade at the live price, start over, delete. */
export function BotControls({
  id,
  enabled,
  hasOpen,
}: {
  id: string;
  enabled: boolean;
  hasOpen: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<string | null>) =>
    start(async () => {
      setError((await fn()) ?? null);
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => togglePaperBotAction(id, !enabled))}
        className={`${btn} border-rule hover:bg-hi/[0.06]`}
      >
        {enabled ? "Pause" : "Resume"}
      </button>
      {hasOpen && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => closePaperTradeAction(id))}
          className={`${btn} border-rule hover:bg-hi/[0.06]`}
        >
          Close open trade now
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm("Start again? Every paper trade of this bot is cleared."))
            run(() => resetPaperBotAction(id));
        }}
        className={`${btn} border-rule hover:bg-hi/[0.06]`}
      >
        Start again
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm("Delete this bot and its paper trades?"))
            run(() => deletePaperBotAction(id));
        }}
        className={`${btn} border-loss/40 text-loss hover:bg-loss/10`}
      >
        Delete
      </button>
      {error && (
        <span role="alert" className="text-xs text-loss">
          {error}
        </span>
      )}
    </div>
  );
}
