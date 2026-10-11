"use client";

import type { ReviewStatus } from "@atc/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { requestReviewAction } from "./actions";

const POLL_MS = 3_000;
const POLL_LIMIT = 40;

/** Starts or refreshes a review; while one is being written, re-checks every few seconds. */
export function ReviewActions({
  positionId,
  status,
  stale,
}: {
  positionId: string;
  status: ReviewStatus;
  stale: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "PENDING") return;
    let polls = 0;
    const id = setInterval(() => {
      polls += 1;
      if (polls > POLL_LIMIT) clearInterval(id);
      else router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [status, router]);

  if (status === "UNAVAILABLE" || status === "LIMIT_REACHED") return null;
  const run = (force: boolean) =>
    start(async () => {
      const res = await requestReviewAction(positionId, force);
      setError(res.error ?? null);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-3">
      {status === "PENDING" ? (
        <p className="text-sm text-coach" role="status">
          Your coach is writing this review…
        </p>
      ) : status === "DONE" ? (
        <Button
          type="button"
          variant={stale ? "primary" : "ghost"}
          size="sm"
          disabled={pending}
          onClick={() => run(true)}
        >
          {pending
            ? "Starting…"
            : stale
              ? "Update review with your latest notes"
              : "Rewrite review"}
        </Button>
      ) : (
        <Button type="button" size="sm" disabled={pending} onClick={() => run(status === "FAILED")}>
          {pending ? "Starting…" : "Get AI review"}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      )}
    </div>
  );
}
