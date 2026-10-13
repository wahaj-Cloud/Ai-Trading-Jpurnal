import { Globe } from "lucide-react";
import { AU, flagCls, GB, JP, US } from "@/features/shell/flags";

/** Simplified flags for the calendar's currencies. */
function EU() {
  return (
    <svg viewBox="0 0 20 14" className={flagCls} aria-hidden="true">
      <rect width="20" height="14" fill="#003399" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <circle
            key={a}
            cx={10 + 4 * Math.cos(a)}
            cy={7 + 4 * Math.sin(a)}
            r="0.65"
            fill="#ffcc00"
          />
        );
      })}
    </svg>
  );
}
function CA() {
  return (
    <svg viewBox="0 0 20 14" className={flagCls} aria-hidden="true">
      <rect width="20" height="14" fill="#fff" />
      <rect width="5" height="14" fill="#d52b1e" />
      <rect x="15" width="5" height="14" fill="#d52b1e" />
      <path
        d="M10 3.2l1 2 1.6-.6-.6 2.4 1.4.2-2 1.6.2 1.2H9.4l.2-1.2-2-1.6 1.4-.2-.6-2.4 1.6.6z"
        fill="#d52b1e"
      />
    </svg>
  );
}
function CH() {
  return (
    <svg viewBox="0 0 20 14" className={flagCls} aria-hidden="true">
      <rect width="20" height="14" fill="#d52b1e" />
      <path d="M10 3.5v7M6.5 7h7" stroke="#fff" strokeWidth="2.2" />
    </svg>
  );
}
function NZ() {
  return (
    <svg viewBox="0 0 20 14" className={flagCls} aria-hidden="true">
      <rect width="20" height="14" fill="#012169" />
      <g transform="scale(0.5)">
        <rect width="20" height="14" fill="#012169" />
        <path d="M0 0L20 14M20 0L0 14" stroke="#fff" strokeWidth="2.8" />
        <path d="M10 0V14M0 7H20" stroke="#fff" strokeWidth="4.2" />
        <path d="M10 0V14M0 7H20" stroke="#c8102e" strokeWidth="2.4" />
      </g>
      {[
        [15, 3.5],
        [17, 6.5],
        [13.5, 7],
        [15, 10.5],
      ].map(([x, y]) => (
        <circle
          key={`${x}-${y}`}
          cx={x}
          cy={y}
          r="0.8"
          fill="#c8102e"
          stroke="#fff"
          strokeWidth="0.3"
        />
      ))}
    </svg>
  );
}
function CN() {
  return (
    <svg viewBox="0 0 20 14" className={flagCls} aria-hidden="true">
      <rect width="20" height="14" fill="#de2910" />
      <circle cx="4.5" cy="4" r="1.8" fill="#ffde00" />
      {[
        [7.5, 1.8],
        [8.8, 3.3],
        [8.8, 5.3],
        [7.5, 6.8],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="0.55" fill="#ffde00" />
      ))}
    </svg>
  );
}

const FLAGS: Record<string, () => React.JSX.Element> = {
  USD: US,
  EUR: EU,
  GBP: GB,
  JPY: JP,
  AUD: AU,
  CAD: CA,
  CHF: CH,
  NZD: NZ,
  CNY: CN,
};

export function CurrencyFlag({ currency }: { currency: string }) {
  const Flag = FLAGS[currency];
  return Flag ? <Flag /> : <Globe className="h-3.5 w-5 text-ink-faint" aria-hidden="true" />;
}
