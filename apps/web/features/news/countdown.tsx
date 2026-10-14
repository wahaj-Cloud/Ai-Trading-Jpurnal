"use client";

import { useEffect, useState } from "react";
import { formatUntil } from "./calendar-view";

/** Live "in 1h 05m 09s" until a release, ticking every second. */
export function Countdown({ to, className }: { to: string; className?: string }) {
  const target = new Date(to).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  return (
    <time dateTime={to} className={className} suppressHydrationWarning>
      {formatUntil(target - now)}
    </time>
  );
}
