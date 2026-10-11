"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { markReadAction } from "@/features/goals/actions";

export function MarkAllRead({ disabled }: { disabled: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={disabled || pending}
      onClick={() => start(() => markReadAction("all"))}
    >
      {pending ? "Marking…" : "Mark all as read"}
    </Button>
  );
}
