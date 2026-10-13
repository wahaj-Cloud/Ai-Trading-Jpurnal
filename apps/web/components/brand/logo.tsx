import { useId } from "react";
import { cn } from "@/lib/cn";

export const APP_NAME = "WickMentor";

/**
 * The WickMentor mark: a "W" whose centre peak rises into a green candlestick (the wick in the name),
 * on a deep-blue glass tile. Gradient ids are made unique per instance so several marks can share
 * a page.
 */
export function LogoMark({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("h-7 w-7 shrink-0", className)}>
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22327a" />
          <stop offset="0.55" stopColor="#0e1640" />
          <stop offset="1" stopColor="#070a1f" />
        </linearGradient>
        <radialGradient id={`${id}gl`} cx="0.28" cy="0.12" r="0.85">
          <stop offset="0" stopColor="#fff" stopOpacity="0.24" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}ink`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7cc4ff" />
          <stop offset="0.5" stopColor="#4d94ff" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id={`${id}cd`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6ff7c8" />
          <stop offset="1" stopColor="#1fb886" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${id}bg)`} />
      <rect width="64" height="64" rx="15" fill={`url(#${id}gl)`} />
      <rect
        x="0.75"
        y="0.75"
        width="62.5"
        height="62.5"
        rx="14.25"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.2"
        strokeWidth="1.5"
      />
      <path
        d="M12.5 21 L22 47.5 L32 31.5 L42 47.5 L51.5 21"
        fill="none"
        stroke={`url(#${id}ink)`}
        strokeWidth="5.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M32 7.5 V28" stroke="#6ff7c8" strokeWidth="2" strokeLinecap="round" />
      <rect x="28" y="12.5" width="8" height="11.5" rx="1.8" fill={`url(#${id}cd)`} />
    </svg>
  );
}

/** "Wick" in ink, "Mentor" in the brand gradient. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-2.5 text-lg font-bold tracking-tight text-ink",
        className,
      )}
    >
      <LogoMark className="h-8 w-8" />
      <span>
        Wick
        <span className="bg-[linear-gradient(90deg,#7cc4ff,#4d94ff_50%,#8b5cf6)] bg-clip-text text-transparent">
          Mentor
        </span>
      </span>
    </span>
  );
}
