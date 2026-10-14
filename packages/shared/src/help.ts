import { z } from "zod";

/**
 * In-app help: how to use WickMentor. One source of truth for the help assistant's instant answers
 * (matched in the browser, free) and the knowledge it is given when a question needs the AI.
 * Nothing here is about a particular user; the assistant never sees anyone's data.
 */
export interface HelpTopic {
  id: string;
  question: string;
  answer: string;
  /** Extra words people use for this topic. */
  keywords: string;
  /** Page that does it, for a "Go there" button. */
  href?: string;
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "connect-exchange",
    question: "How do I connect an exchange?",
    answer:
      "Open Exchanges → Connect, pick your exchange and follow the steps. You create a READ-ONLY API key on the exchange (no trading, no withdrawals) and paste it in. We check it is read-only before saving it, encrypted.",
    keywords: "binance mexc kucoin bingx api key add link connect exchange account setup",
    href: "/exchanges/connect",
  },
  {
    id: "exchanges-supported",
    question: "Which exchanges are supported?",
    answer:
      "Binance Futures, MEXC Futures, KuCoin Futures, BingX and Exness (MetaTrader 4/5). More exchanges such as Bybit and OKX are coming.",
    keywords: "supported exchanges list bybit okx hyperliquid bitget brokers which",
    href: "/exchanges/connect",
  },
  {
    id: "exness",
    question: "How do I connect Exness (MetaTrader)?",
    answer:
      "Exchanges → Connect → Exness. Enter your MT4/MT5 account number, the server name exactly as Exness shows it (e.g. Exness-MT5Real8) and an INVESTOR (read-only) password, never your trading password. Set an investor password in the Exness Personal Area → your account → Change investor password. The first connection takes a few minutes. Exness is included with the Premium plan.",
    keywords: "exness metatrader mt4 mt5 investor password server forex gold broker",
    href: "/exchanges/connect",
  },
  {
    id: "key-safety",
    question: "Is my API key safe?",
    answer:
      "Yes. We only accept read-only keys and refuse keys that can trade or withdraw. Keys are encrypted at rest and never shown again after you save them. For extra safety, restrict the key to our IP addresses on the exchange (shown on the Exchanges page).",
    keywords: "safe security secure encrypted read only withdraw trade permission ip whitelist",
    href: "/exchanges",
  },
  {
    id: "sync",
    question: "How often are my trades synced?",
    answer:
      "Automatically every few minutes. You can also press “Sync now” on the Exchanges page. The first sync imports your past trades, which can take a little longer.",
    keywords: "sync update refresh new trades missing not showing delay import history",
    href: "/exchanges",
  },
  {
    id: "missing-trades",
    question: "Some trades are missing. What should I do?",
    answer:
      "Check the Exchanges page: the connection should say Connected and show when it last synced. Press “Sync now” and wait a minute. Only futures trades from the supported accounts are imported, and each exchange only lets us read a limited history. If a key expired, use “Replace key”.",
    keywords: "missing trades wrong not showing gone incomplete history expired key",
    href: "/exchanges",
  },
  {
    id: "csv-import",
    question: "Can I import trades from a file?",
    answer: "Yes. Trades → Import lets you upload a CSV export from your exchange.",
    keywords: "csv import upload file excel spreadsheet manual add trades",
    href: "/trades/import",
  },
  {
    id: "journal",
    question: "How do I journal a trade?",
    answer:
      "Open Trades, click a trade, and add your notes, setup, mistakes, emotions and stop/target. The Journal page lists everything you have written.",
    keywords: "journal notes write diary setup mistakes emotion screenshot tag",
    href: "/journal",
  },
  {
    id: "ai-review",
    question: "What is the AI trade review?",
    answer:
      "Each closed trade gets a grade (A–F) by fixed rules, and the AI writes a short review: entry, exit, risk, mistakes and what to do next time. Open any trade to see it. Reviews per month depend on your plan.",
    keywords: "ai review grade score analysis feedback trade report card",
    href: "/trades",
  },
  {
    id: "ai-coach",
    question: "How do I use the AI Coach?",
    answer:
      "Open AI Coach and ask about your trading, e.g. “Why did I lose today?” or “What should I focus on tomorrow?”. It answers from your own numbers. Questions per day and the monthly AI allowance depend on your plan. Questions about your personal results belong there, not in this help chat.",
    keywords: "coach chat ask ai mentor psychology why lose improve questions allowance limit",
    href: "/coach",
  },
  {
    id: "ai-limit",
    question: "I reached my AI limit. What now?",
    answer:
      "Daily coach questions reset at midnight UTC and the monthly AI allowance resets on the 1st. Upgrading your plan gives you more. Rules-based grades, stats and charts keep working without limits.",
    keywords: "limit reached allowance used up quota reset upgrade more questions",
    href: "/billing",
  },
  {
    id: "currency",
    question: "How do I change the currency?",
    answer:
      "Settings → Display currency, or the globe button in the top bar. Amounts are converted from US$ at the latest daily rate.",
    keywords: "currency pkr rupee euro dollar convert rate money symbol",
    href: "/settings",
  },
  {
    id: "timezone",
    question: "How do I change my timezone?",
    answer:
      "Settings → Timezone. Daily totals, sessions and the calendar then follow your own clock.",
    keywords: "timezone time zone clock wrong day hours karachi",
    href: "/settings",
  },
  {
    id: "dashboard",
    question: "Can I customize the dashboard?",
    answer:
      "Yes. Click “Customize” at the top of the Dashboard to show, hide or reorder cards. Hidden cards can be added back at any time.",
    keywords: "dashboard customize widgets cards hide show move rearrange layout",
    href: "/dashboard",
  },
  {
    id: "theme",
    question: "How do I change the theme?",
    answer:
      "Click the palette button in the top bar. Choose Light, Dark or System and a colour preset. It is saved on this device.",
    keywords: "theme dark light mode colour color palette look appearance",
  },
  {
    id: "reports",
    question: "How do I download a report?",
    answer:
      "Reports → choose daily, weekly, monthly or yearly, then download as PDF, Excel or CSV.",
    keywords: "report export download pdf excel csv weekly monthly yearly print",
    href: "/reports",
  },
  {
    id: "goals",
    question: "How do I set risk limits and goals?",
    answer:
      "Goals → set weekly/monthly goals and risk limits such as maximum daily loss, maximum trades per day and maximum drawdown. You get a warning when you get close.",
    keywords: "goals risk limit max daily loss drawdown trades per day target discipline",
    href: "/goals",
  },
  {
    id: "news",
    question: "Where is the economic calendar?",
    answer:
      "News in the menu shows market-moving releases (CPI, rate decisions, jobs) with High/Medium/Low impact, currency and date filters, and a countdown to the next one.",
    keywords: "news economic calendar forex factory cpi nfp fomc high impact events",
    href: "/news",
  },
  {
    id: "calculators",
    question: "Where are the calculators?",
    answer:
      "Calculators in the menu: position size, risk/reward, profit, recovery after a loss, expectancy, required win rate, Kelly, risk of ruin and a Monte Carlo simulation.",
    keywords: "calculator position size lot risk reward kelly ruin monte carlo",
    href: "/calculators",
  },
  {
    id: "metrics",
    question: "What do win rate, profit factor and expectancy mean?",
    answer:
      "Win rate: winning ÷ (winning + losing) trades. Profit factor: total won ÷ total lost (above 1 = profitable). Expectancy: average result per trade. All definitions are on the Help page.",
    keywords: "win rate profit factor expectancy drawdown metrics meaning definition",
    href: "/help",
  },
  {
    id: "plans",
    question: "What do the plans include?",
    answer:
      "Free, Pro and Premium differ in exchange connections, history length, AI reviews, coach questions and Exness access. See Billing for the current details and to upgrade or cancel.",
    keywords:
      "plan price pricing upgrade downgrade cancel subscription pro premium free billing pay",
    href: "/billing",
  },
  {
    id: "notifications",
    question: "How do I change notifications?",
    answer:
      "Settings → Notifications: daily and journal reminders, weekly/monthly reports, goal reminders and risk warnings.",
    keywords: "notifications email reminder alerts turn off on",
    href: "/settings#notifications",
  },
  {
    id: "disconnect",
    question: "How do I remove an exchange?",
    answer:
      "Exchanges → Disconnect on that connection. The key is deleted; your past trades stay in your journal.",
    keywords: "remove delete disconnect exchange key revoke",
    href: "/exchanges",
  },
  {
    id: "what-if",
    question: "What is What-If Lab?",
    answer:
      "Lab → What-If Lab replays your real closed trades with rules you choose: stop after N losses in a row, a daily loss limit, a maximum number of trades a day, skip trades tagged FOMO or revenge, only certain sessions, days or coins, or a cap on risk per trade. It shows your real result next to the disciplined one. It never invents trades. Included with Pro; Free shows a preview.",
    keywords: "what if lab replay rules discipline scenario simulate my trades stop after losses",
    href: "/lab",
  },
  {
    id: "setup-alerts",
    question: "How do setup alerts work?",
    answer:
      'Setup Alerts → New setup. Pick coins, a timeframe and conditions (EMA trend, RSI, VWAP, liquidity sweep, fair value gap, order block, BOS/CHOCH, session, volume). Preview shows where it would have fired. Once saved, you get an alert when a candle closes and every condition is true. Trades opened soon after an alert are marked "Planned setup" in your journal. They are your own rules, never buy or sell signals. Free has 1 setup, Pro 5 (with email), Premium 20.',
    keywords:
      "setup alert alerts notify signal my setup rule builder condition fvg order block sweep",
    href: "/setups",
  },
  {
    id: "strategy-lab",
    question: "How do I backtest a setup?",
    answer:
      "Lab → Strategy Lab (Premium). Choose a saved setup, up to 5 coins, a date range and an exit plan (stop beyond the last swing, a fixed % or an ATR multiple, a target in R, risk per trade). The test includes fees, slippage and real funding, enters on the next candle's open, and warns when there are too few trades or results fade later in the period.",
    keywords: "backtest back test strategy lab test setup history past candles simulate",
    href: "/lab/strategy",
  },
  {
    id: "market-pulse",
    question: "What is Market Pulse?",
    answer:
      'Market Pulse shows how closely the top 100 Binance futures coins move with Bitcoin over 24 hours, 7 days and 30 days, updated every hour. "Follows BTC" means it usually moves with BTC; "decoupled today" means it normally follows BTC but is moving on its own now. Each trade also records this link at entry, so you can see how you do on coins that follow BTC versus independent ones. It is context, not a signal. Free shows the top 20 coins for 24 hours.',
    keywords: "market pulse correlation btc bitcoin beta follows decoupled independent",
    href: "/market",
  },
];

/** Greeting and starter questions for the help assistant. */
export const HELP_SUGGESTIONS = [
  "How do I connect an exchange?",
  "Is my API key safe?",
  "How do I change the currency?",
  "Can I customize the dashboard?",
];

export const HELP_QUESTION_MAX = 500;

export const helpAskSchema = z
  .object({
    question: z.string().trim().min(2).max(HELP_QUESTION_MAX),
    /** The last few turns of this help chat (kept in the browser only, never stored). */
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().max(2_000),
          })
          .strict(),
      )
      .max(6)
      .default([]),
  })
  .strict();
export type HelpAskInput = z.infer<typeof helpAskSchema>;

export interface HelpAnswerDto {
  answer: string;
  /** Pages the answer points to. */
  links: { label: string; href: string }[];
}

/**
 * Text that looks like a secret (API key, secret, long random token) or a password being shared.
 * The help chat refuses it before anything is sent.
 */
export function looksLikeSecret(text: string): boolean {
  if (
    /\b(password|passphrase|secret key|api secret|private key|seed phrase|mnemonic)\s*[:=]/i.test(
      text,
    )
  )
    return true;
  // Long unbroken tokens mixing letters and digits (exchange keys are 32–64 chars).
  return /(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{28,}/.test(text);
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

const STOP = new Set([
  "how",
  "the",
  "can",
  "what",
  "where",
  "does",
  "and",
  "for",
  "you",
  "with",
  "this",
  "that",
  "are",
  "why",
  "use",
]);

/**
 * Best matching help topic for a question, or null when nothing fits well enough to answer
 * without the AI. Simple word overlap with each topic's question and keywords.
 */
export function matchHelpTopic(question: string, minScore = 0.6): HelpTopic | null {
  const q = words(question).filter((w) => !STOP.has(w));
  if (q.length === 0) return null;
  let best: { topic: HelpTopic; score: number } | null = null;
  for (const topic of HELP_TOPICS) {
    const vocab = new Set(words(`${topic.question} ${topic.keywords}`));
    let score = 0;
    for (const w of q) {
      if (vocab.has(w)) score += 1;
      else if ([...vocab].some((v) => v.length > 4 && (v.startsWith(w) || w.startsWith(v))))
        score += 0.5;
    }
    const ratio = score / q.length;
    if (!best || ratio > best.score) best = { topic, score: ratio };
  }
  return best && best.score >= minScore ? best.topic : null;
}

const PAGE_LABELS: Record<string, string> = {
  "/exchanges": "Exchanges",
  "/exchanges/connect": "Connect an exchange",
  "/trades": "Trades",
  "/trades/import": "Import trades",
  "/journal": "Journal",
  "/coach": "AI Coach",
  "/billing": "Plans and billing",
  "/settings": "Settings",
  "/settings#notifications": "Notification settings",
  "/dashboard": "Dashboard",
  "/reports": "Reports",
  "/goals": "Goals",
  "/news": "Economic calendar",
  "/calculators": "Calculators",
  "/help": "Help",
};

/** "Go there" link for a topic's page. */
export function helpLink(topic: HelpTopic): { label: string; href: string } | null {
  if (!topic.href) return null;
  return { label: PAGE_LABELS[topic.href] ?? "Open", href: topic.href };
}
