"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { requestContextAction } from "./actions";

/** Queues market analysis, then re-checks for the result for up to two minutes. */
export function AnalyzeButton({ positionId, label }: { positionId: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!waiting) return;
    let polls = 0;
    const id = setInterval(() => {
      polls += 1;
      if (polls > 40) {
        clearInterval(id);
        setWaiting(false);
      } else router.refresh();
    }, 3_000);
    return () => clearInterval(id);
  }, [waiting, router]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending || waiting}
        onClick={() =>
          start(async () => {
            const res = await requestContextAction(positionId);
            setError(res.error ?? null);
            if (!res.error) setWaiting(true);
          })
        }
      >
        {pending || waiting ? "Analysing the chart…" : label}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      )}
    </div>
  );
}
