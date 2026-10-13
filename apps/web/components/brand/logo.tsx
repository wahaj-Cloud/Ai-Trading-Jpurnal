import { cn } from "@/lib/cn";

/** Mark: a single candle whose wick continues into a rising trend line. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("h-6 w-6", className)}>
      <rect width="24" height="24" rx="6" fill="#1b2433" />
      <path d="M8 5v3M8 16v3" stroke="#8c99ac" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="6" y="8" width="4" height="8" rx="1" fill="#e7ecf3" />
      <path
        d="M12.5 15.5l3-3 2 2 3-5"
        stroke="#3d8bff"
        strokeWidth="1.75"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn("flex items-center gap-2.5 font-semibold tracking-tight text-ink", className)}
    >
      <LogoMark />
      <span>AI Trading Coach</span>
    </span>
  );
}
