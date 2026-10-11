"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { coachDayAction } from "./actions";

/** Writes (or rewrites) the coaching note for a day on demand. */
export function CoachDayButton({
  date,
  label = "Coach me on today",
}: {
  date: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await coachDayAction(date);
            setMessage(
              res.error ?? (res.note === null ? "No closed trades on this day yet." : null),
            );
            router.refresh();
          })
        }
      >
        {pending ? "Writing your note…" : label}
      </Button>
      {message && (
        <p role="status" className="text-sm text-ink-muted">
          {message}
        </p>
      )}
    </div>
  );
}
