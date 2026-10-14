import type { ShowcaseItem } from "./showcase";

/** Landing page copy in one place, so wording can be changed without touching the layout. */

export const SHOWCASE: ShowcaseItem[] = [
  {
    id: "dashboard",
    tab: "Dashboard",
    title: "Your whole trading life on one screen",
    body: "Results, best and worst sessions, market hours and what to work on next, all filled in automatically from your exchanges.",
    points: [
      "Net P&L, win rate, profit factor and drawdown, updated every few minutes",
      "Your best trading session, and the one quietly costing you",
      "Customise the layout: reorder and hide widgets",
    ],
    image: "/landing/dashboard.webp",
  },
  {
    id: "coach",
    tab: "AI Coach",
    title: "A coach that has read every trade you took",
    body: 'Ask "why did I lose today?" and get an answer built from your own trades, not textbook advice.',
    points: [
      "Daily and weekly coaching notes with one clear focus",
      "Detects FOMO, revenge trading, overtrading and oversizing",
      "Every number the coach quotes is computed, never guessed",
    ],
    image: "/landing/coach.webp",
  },
  {
    id: "whatif",
    tab: "What-If Lab",
    title: "See what your own rules are worth, in dollars",
    body: "Replay your real trades with a daily loss limit, a trade cap, or without your FOMO trades, and compare the two equity curves.",
    points: [
      "Stop after N losses, max trades a day, risk cap per trade",
      "Skip trades tagged FOMO, revenge or overtrading",
      "Only removes or scales real trades: nothing is invented",
    ],
    image: "/landing/whatif.webp",
    plan: "Pro",
  },
  {
    id: "strategy",
    tab: "Strategy Lab",
    title: "Backtest your setup before you risk money on it",
    body: "Test a saved setup on up to 2 years of candles with fees, slippage and real funding included.",
    points: [
      "Every simulated trade on a chart, plus a CSV export",
      "Overfitting check: first 70% of the period vs the last 30%",
      "Honest by design: next-candle entries, stop assumed first",
    ],
    image: "/landing/strategy.webp",
    plan: "Premium",
  },
  {
    id: "setups",
    tab: "Setup Alerts",
    title: "Your setup. Your alert.",
    body: "Build the setup you already trade from simple conditions and get told the moment it forms on a closed candle.",
    points: [
      "Liquidity sweeps, fair value gaps, order blocks, BOS/CHOCH, EMA, RSI, VWAP",
      "Preview where it would have fired before you save it",
      "Trades are marked planned or unplanned, and the coach compares them",
    ],
    image: "/landing/setup.webp",
  },
  {
    id: "live",
    tab: "Live Markets",
    title: "Live prices, with your trades on the chart",
    body: "The top 100 futures coins updating every second, and a live chart with your open positions and live P&L.",
    points: [
      "Timeframes from 1 minute to 1 day",
      "Your entry lines and live profit on the chart",
      "Favourites and instant search",
    ],
    image: "/landing/live.webp",
  },
  {
    id: "pulse",
    tab: "Market Pulse",
    title: "Know which coins really follow Bitcoin",
    body: "Correlation and beta to BTC for the top 100 coins over 24 hours, 7 days and 30 days, updated every hour.",
    points: [
      "Spot coins that decoupled from BTC today",
      "See how you perform on BTC followers vs independent coins",
      "Context for your decisions, never a signal",
    ],
    image: "/landing/pulse.webp",
  },
  {
    id: "analytics",
    tab: "Analytics",
    title: "Every statistic a serious trader needs",
    body: "Equity curve, drawdown, streaks, fees and funding, by coin, session, weekday and hour.",
    points: [
      "Calendar heatmap and monthly breakdowns",
      "PDF, Excel and CSV reports",
      "Shown in your own currency",
    ],
    image: "/landing/analytics.webp",
  },
];

export const BEHAVIOURS = [
  "FOMO entries",
  "Revenge trading",
  "Overtrading",
  "Oversizing after losses",
  "Holding losers",
  "Cutting winners early",
  "Undisciplined entries",
  "Overconfidence after wins",
  "Impatience",
  "Trading your worst session",
  "No stop loss",
  "Trading against BTC",
];

export const COMPARISON: Array<{ feature: string; us: string | true; them: string | false }> = [
  { feature: "Auto-sync from Binance, MEXC, KuCoin, BingX", us: true, them: "Often manual or CSV" },
  { feature: "MetaTrader 4/5 brokers (Exness)", us: true, them: "Sometimes" },
  { feature: "AI review and grade of every trade", us: true, them: false },
  { feature: "Behaviour detection (FOMO, revenge, oversizing)", us: true, them: false },
  { feature: "What-If replay of your own rules", us: true, them: false },
  { feature: "Backtest your setup on 2 years of candles", us: true, them: false },
  { feature: "Alerts when your own setup forms", us: true, them: false },
  { feature: "Live prices and charts with your positions", us: true, them: false },
  { feature: "BTC correlation for the top 100 coins", us: true, them: false },
  { feature: "Economic calendar with live CPI and jobs data", us: true, them: false },
  { feature: "PDF, Excel and CSV reports", us: true, them: "Sometimes" },
  { feature: "Free plan, no card needed", us: true, them: "Sometimes" },
];

export const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Is it safe to connect my exchange?",
    a: "Yes. You create a read-only API key: it can see trades but cannot place orders or withdraw. We check the key is read-only before saving it, encrypt it with AES-256, and you can delete it any time. For Exness we use your investor (read-only) password, never your trading password.",
  },
  {
    q: "Which exchanges and brokers are supported?",
    a: "Binance Futures, MEXC Futures, KuCoin Futures, BingX and Exness (MetaTrader 4 and 5). You can connect several accounts at once. Bybit and OKX are next.",
  },
  {
    q: "Does WickMentor trade for me or give signals?",
    a: "No. WickMentor never places trades and never tells you to buy or sell. It reviews what you did, shows your patterns, and alerts you only on setups you defined yourself.",
  },
  {
    q: "What do I get on the free plan?",
    a: "Automatic trade sync, the journal, analytics, AI trade reviews and coach questions within monthly limits, Live Markets, the economic calendar and one setup alert. No card needed.",
  },
  {
    q: "How is the AI different from a chatbot?",
    a: "Every number is calculated by our software from your real trades first. The AI only explains those facts and coaches you on them, so it cannot invent statistics.",
  },
  {
    q: "Can I cancel any time?",
    a: "Yes. Paid plans are monthly and can be cancelled from Billing in one click. You keep your journal on the free plan.",
  },
];
