import type { Market } from "@/features/dashboard/market-hours";

/** Small simplified national flags for the market clock (emoji flags don't render on Windows). */
export const flagCls =
  "h-3.5 w-5 shrink-0 overflow-hidden rounded-[3px] shadow-[0_0_0_1px_rgba(0,0,0,0.15)]";

export function US() {
  return (
    <svg viewBox="0 0 20 14" className={flagCls} aria-hidden="true">
      <rect width="20" height="14" fill="#fff" />
      {[0, 4, 8, 12].map((y) => (
        <rect key={y} y={y} width="20" height="2" fill="#b22234" />
      ))}
      <rect width="9" height="8" fill="#3c3b6e" />
      {[2, 5].map((y) =>
        [1.8, 4.5, 7.2].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="0.6" fill="#fff" />),
      )}
    </svg>
  );
}

function Union({ w = 20, h = 14 }: { w?: number; h?: number }) {
  return (
    <>
      <rect width={w} height={h} fill="#012169" />
      <path d={`M0 0L${w} ${h}M${w} 0L0 ${h}`} stroke="#fff" strokeWidth={h * 0.2} />
      <path d={`M0 0L${w} ${h}M${w} 0L0 ${h}`} stroke="#c8102e" strokeWidth={h * 0.08} />
      <path d={`M${w / 2} 0V${h}M0 ${h / 2}H${w}`} stroke="#fff" strokeWidth={h * 0.3} />
      <path d={`M${w / 2} 0V${h}M0 ${h / 2}H${w}`} stroke="#c8102e" strokeWidth={h * 0.17} />
    </>
  );
}

export function GB() {
  return (
    <svg viewBox="0 0 20 14" className={flagCls} aria-hidden="true">
      <Union />
    </svg>
  );
}

export function JP() {
  return (
    <svg viewBox="0 0 20 14" className={flagCls} aria-hidden="true">
      <rect width="20" height="14" fill="#fff" />
      <circle cx="10" cy="7" r="4.2" fill="#bc002d" />
    </svg>
  );
}

export function AU() {
  return (
    <svg viewBox="0 0 20 14" className={flagCls} aria-hidden="true">
      <rect width="20" height="14" fill="#012169" />
      <g transform="scale(0.5)">
        <Union />
      </g>
      <circle cx="5" cy="10.8" r="1.3" fill="#fff" />
      {[
        [15, 3],
        [17.3, 6.6],
        [13.4, 8.4],
        [15.4, 11.6],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="0.75" fill="#fff" />
      ))}
    </svg>
  );
}

export function MarketFlag({ id }: { id: Market["id"] }) {
  return id === "NEW_YORK" ? <US /> : id === "LONDON" ? <GB /> : id === "TOKYO" ? <JP /> : <AU />;
}
