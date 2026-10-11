"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { disconnectAction } from "./actions";

/** Two-step confirm: a destructive action should never happen on a single mis-tap. */
export function DisconnectButton({ accountId, label }: { accountId: string; label: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Disconnect
      </Button>
    );
  }
  return (
    <fieldset className="flex flex-wrap items-center gap-2" aria-label={`Disconnect ${label}`}>
      <span className="text-sm text-ink-muted">
        Delete the stored key? Imported history is kept.
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await disconnectAction(accountId);
            if (res.error) setError(res.error);
            else setConfirming(false);
          })
        }
      >
        {pending ? "Disconnecting…" : "Delete key"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
        Cancel
      </Button>
      {error && <p className="w-full text-sm text-loss">{error}</p>}
    </fieldset>
  );
}
