"use client";

import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-lg font-semibold">This page could not load</h1>
      <p className="mt-2 text-sm text-ink-muted">
        We could not reach the AI Trading Coach service. Try again in a moment. If it keeps
        happening, contact support and quote reference {error.digest ?? "unknown"}.
      </p>
      <Button className="mt-6" variant="secondary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
