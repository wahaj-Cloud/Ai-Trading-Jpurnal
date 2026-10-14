"use client";

import { Pause, Play, Trash2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteSetupAction, dismissAlertAction, toggleSetupAction } from "./actions";

export function SetupControls({ id, active, name }: { id: string; active: boolean; name: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const act = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.message ?? "Something went wrong");
    });
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => act(() => toggleSetupAction(id, !active))}
      >
        {active ? (
          <Pause className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Play className="h-4 w-4" aria-hidden="true" />
        )}
        {active ? "Pause" : "Resume"}
      </Button>
      {confirm ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-loss"
          disabled={pending}
          onClick={() => act(() => deleteSetupAction(id))}
        >
          Delete "{name}"?
        </Button>
      ) : (
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm(true)}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete
        </Button>
      )}
      {error && <span className="text-xs text-loss">{error}</span>}
    </div>
  );
}

export function DismissAlert({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await dismissAlertAction(id)))}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-faint hover:bg-hi/10 hover:text-ink"
    >
      <X className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">Dismiss alert</span>
    </button>
  );
}
