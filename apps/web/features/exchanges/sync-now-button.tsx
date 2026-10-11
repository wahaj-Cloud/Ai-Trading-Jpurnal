"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { syncNowAction } from "./actions";

export function SyncNowButton({ accountId, busy }: { accountId: string; busy: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending || busy}
        onClick={() =>
          startTransition(async () => {
            const res = await syncNowAction(accountId);
            setMessage(res.error ?? "Sync queued.");
            router.refresh();
          })
        }
      >
        {pending ? "Queuing…" : "Sync now"}
      </Button>
      {message && (
        <span role="status" className="w-full text-xs text-ink-muted sm:w-auto">
          {message}
        </span>
      )}
    </>
  );
}
