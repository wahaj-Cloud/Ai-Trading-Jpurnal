"use client";

import type { ServiceStatusDto } from "@atc/shared";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getServiceStatusAction } from "@/features/status/actions";

export function ServiceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // undefined: still checking; null: the service itself is unreachable.
  const [status, setStatus] = useState<ServiceStatusDto | null | undefined>(undefined);
  useEffect(() => {
    getServiceStatusAction()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  const offline = status === null || status?.database === "down";
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-lg font-semibold">
        {offline ? "WickMentor is briefly offline" : "This page could not load"}
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        {offline
          ? "Your trades, journal and settings are safe. We're restoring the service; it comes back by itself, so try again in a few minutes."
          : `We could not reach the WickMentor service. Try again in a moment. If it keeps happening, contact support and quote reference ${error.digest ?? "unknown"}.`}
      </p>
      <Button className="mt-6" variant="secondary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
