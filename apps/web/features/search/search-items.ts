/**
 * Results for the top-bar search: pages and tools, traded coins, months, and "ask the coach".
 * Pure so it can be tested and run on every keystroke without a server round trip.
 */

export type SearchGroup = "Ask" | "Pages" | "Coins" | "Months";

export interface SearchItem {
  id: string;
  group: SearchGroup;
  label: string;
  hint?: string;
  href: string;
}

interface PageEntry {
  label: string;
  href: string;
  keywords: string;
  hint?: string;
  admin?: boolean;
}

const PAGES: PageEntry[] = [
  { label: "Dashboard", href: "/dashboard", keywords: "home overview summary today" },
  { label: "Trades", href: "/trades", keywords: "history closed positions list" },
  { label: "Open positions", href: "/trades?view=open", keywords: "live open now running" },
  { label: "Import trades from CSV", href: "/trades/import", keywords: "upload csv file import" },
  { label: "Journal", href: "/journal", keywords: "notes review diary" },
  { label: "AI Coach", href: "/coach", keywords: "chat ask mentor advice psychology" },
  {
    label: "Analytics",
    href: "/analytics",
    keywords: "stats performance session weekday coin drawdown equity",
  },
  { label: "Reports", href: "/reports", keywords: "pdf excel csv export daily weekly monthly" },
  {
    label: "Economic calendar (news)",
    href: "/news",
    keywords: "news forex factory calendar cpi nfp fomc events high impact",
  },
  { label: "Goals and risk limits", href: "/goals", keywords: "target max loss daily limit" },
  {
    label: "Calculators",
    href: "/calculators",
    keywords:
      "position size risk reward profit kelly ruin monte carlo expectancy drawdown win rate lot",
  },
  { label: "Exchanges", href: "/exchanges", keywords: "api keys binance mexc exness connections" },
  {
    label: "Connect an exchange",
    href: "/exchanges/connect",
    keywords: "add api key binance mexc exness bybit",
  },
  {
    label: "Settings",
    href: "/settings",
    keywords: "profile timezone currency colour preferences",
  },
  { label: "Notifications", href: "/notifications", keywords: "alerts reminders inbox" },
  {
    label: "Plans and billing",
    href: "/billing",
    keywords: "subscription upgrade premium pro pay",
  },
  { label: "Help", href: "/help", keywords: "support faq guide how" },
  { label: "Admin", href: "/admin", keywords: "users logs announcements", admin: true },
];

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const QUESTION_START =
  /^(why|how|what|which|when|where|who|should|can|could|do|did|does|is|are|was|were|am|compare|explain|tell|give|show me why|help)\b/i;

/** True when the text reads like a question for the coach rather than a page name. */
export function looksLikeQuestion(q: string): boolean {
  const t = q.trim();
  return t.endsWith("?") || QUESTION_START.test(t) || t.split(/\s+/).length >= 4;
}

function score(label: string, keywords: string, q: string): number {
  const l = label.toLowerCase();
  if (l.startsWith(q)) return 3;
  if (l.split(/\s+/).some((w) => w.startsWith(q))) return 2;
  if (l.includes(q)) return 1.5;
  if (keywords.split(/\s+/).some((w) => w.startsWith(q))) return 1;
  return 0;
}

const monthLabel = (y: number, m: number) =>
  `${MONTH_NAMES[m - 1]?.replace(/^./, (c) => c.toUpperCase())} ${y}`;

/** Months the query names, newest first, never after `current` (YYYY-MM). */
export function matchMonths(q: string, current: string): Array<{ key: string; label: string }> {
  const t = q.trim().toLowerCase();
  const [cy, cm] = current.split("-").map(Number) as [number, number];
  const out: Array<{ key: string; label: string }> = [];
  const push = (y: number, m: number) => {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key <= current && !out.some((o) => o.key === key))
      out.push({ key, label: monthLabel(y, m) });
  };

  const ym = t.match(/^(\d{4})[-/](\d{1,2})$/);
  const my = t.match(/^(\d{1,2})[-/](\d{4})$/);
  if (ym || my) {
    const y = Number(ym ? ym[1] : my?.[2]);
    const m = Number(ym ? ym[2] : my?.[1]);
    if (m >= 1 && m <= 12) push(y, m);
    return out;
  }

  const named = t.match(/^([a-z]{3,})\s*(\d{4})?$/);
  if (!named) return out;
  const idx = MONTH_NAMES.findIndex((n) => n.startsWith(named[1] as string));
  if (idx === -1) return out;
  const m = idx + 1;
  if (named[2]) {
    push(Number(named[2]), m);
  } else {
    const latest = m <= cm ? cy : cy - 1;
    push(latest, m);
    push(latest - 1, m);
  }
  return out;
}

export const SUGGESTED_QUESTIONS = [
  "Which trading session is best for me?",
  "Why did I lose today?",
  "Which mistakes am I repeating?",
  "What should I focus on tomorrow?",
  "Compare this week with last week",
];

export function buildResults({
  query,
  symbols,
  currentMonth,
  isAdmin = false,
}: {
  query: string;
  /** The trader's own symbols, most traded first. */
  symbols: readonly string[];
  currentMonth: string;
  isAdmin?: boolean;
}): SearchItem[] {
  const q = query.trim().toLowerCase();
  const pages = PAGES.filter((p) => isAdmin || !p.admin);
  const ask = (text: string): SearchItem => ({
    id: `ask:${text}`,
    group: "Ask",
    label: text,
    hint: "Ask AI Coach",
    href: `/coach?q=${encodeURIComponent(text)}`,
  });

  if (!q) {
    return [
      ...SUGGESTED_QUESTIONS.slice(0, 3).map(ask),
      ...pages
        .filter((p) => ["/dashboard", "/trades", "/calculators", "/analytics"].includes(p.href))
        .map((p) => ({
          id: `page:${p.href}`,
          group: "Pages" as const,
          label: p.label,
          href: p.href,
        })),
    ];
  }

  const pageHits = pages
    .map((p) => ({ p, s: score(p.label, p.keywords, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map(({ p }) => ({
      id: `page:${p.href}`,
      group: "Pages" as const,
      label: p.label,
      href: p.href,
    }));

  const sym = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const coinHits: SearchItem[] =
    sym.length >= 2 && !q.includes(" ")
      ? symbols
          .filter((s) => s.includes(sym))
          .sort((a, b) => Number(b.startsWith(sym)) - Number(a.startsWith(sym)))
          .slice(0, 4)
          .map((s) => ({
            id: `coin:${s}`,
            group: "Coins" as const,
            label: s,
            hint: "Show trades",
            href: `/trades?symbol=${encodeURIComponent(s)}`,
          }))
      : [];

  const monthHits: SearchItem[] = matchMonths(q, currentMonth).map((m) => ({
    id: `month:${m.key}`,
    group: "Months" as const,
    label: m.label,
    hint: "Open month",
    href: `/months/${m.key}`,
  }));

  const askItem = ask(query.trim());
  const question = looksLikeQuestion(query);
  return question
    ? [askItem, ...pageHits, ...coinHits, ...monthHits]
    : [...monthHits, ...coinHits, ...pageHits, askItem];
}
