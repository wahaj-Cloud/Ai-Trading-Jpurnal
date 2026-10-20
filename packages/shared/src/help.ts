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
      "Binance Futures, Bybit (USDT and USDC perpetuals), OKX (perpetual swaps), MEXC Futures, KuCoin Futures, BingX and Exness (MetaTrader 4/5). OKX keys need the passphrase you set when creating the key. Bitget and Hyperliquid are next.",
    keywords: "supported exchanges list bybit okx hyperliquid bitget brokers which",
    href: "/exchanges/connect",
  },
  {
    id: "exness",
    question: "How do I connect Exness (MetaTrader)?",
    answer:
      "Exchanges → Connect → Exness. Enter your MT4/MT5 account number, the server name exactly as Exness shows it (e.g. Exness-MT5Real8) and an INVESTOR (read-only) password, never your trading password. Set an investor password in the Exness Personal Area → your account → Change investor password. The first connection takes a few minutes. Pro includes one Exness account and Premium two, on top of your crypto exchange connections.",
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
      "Yes. Click “Customize” at the top of the Dashboard. Drag any widget by its handle to a new place (on a phone, press and hold the handle), choose its width, or hide it. “Add widgets” opens the library, sorted into Performance, Coach and discipline, Trading and Markets, where hidden widgets can be added back. Market widgets are short summaries; each links to its full page under Markets. Click “Save layout” and the same layout appears on every device.",
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
    id: "live-markets",
    question: "Where can I see live prices and charts?",
    answer:
      "Live Markets shows Bitcoin, gold (XAU), silver (XAG) and the top 100 Binance futures markets with prices updating every second. The chart works like TradingView: timeframes from 1 minute to 1 week, candles, Heikin Ashi, bars, line or area, indicators (EMA/SMA, Bollinger Bands, VWAP, volume, RSI, MACD), drawing tools (trend line, ray, horizontal and vertical lines, rectangle, Fibonacci) with a magnet, and a countdown to each candle's close under the price. Drawings and settings are saved on your device. Your open positions show with live profit or loss and their liquidation price. Switch to \"TradingView\" for TradingView's own chart with every tool, including spot XAUUSD. Prices come from Binance's public feed, so they are unavailable in regions Binance blocks, such as the USA. Under Indicators → Smart-money zones you can switch on fair value gaps (dashed boxes, shown until price trades back into them) and order blocks (solid boxes, shown until price closes through them; failed blocks that flipped show as breakers), from the same detection your setup alerts use. They are drawn from closed candles, at most 8 gaps and 6 blocks, newest first.",
    keywords:
      "live price chart fvg fair value gap order block breaker smart money zones btc bitcoin gold xau xauusd silver candles realtime ticker markets watchlist tradingview drawing trendline fibonacci indicators ema rsi macd countdown candle close timer",
    href: "/live",
  },
  {
    id: "liquidation-map",
    question: "What is the liquidation map?",
    answer:
      "Live Markets → Liq. map shows, behind the candles, where many traders' positions would be liquidated if price got there: brighter bands mean more value at risk. No exchange publishes real liquidation prices, so it is an estimate built every 5 minutes from public open interest on Binance, Bybit and OKX (when open interest rises, new positions were opened near that price), who was buying or selling, and a typical leverage mix. Levels disappear once price trades through them. The card under the chart lists the biggest clusters above and below the price. Free shows Bitcoin; Pro and Premium cover BTC, ETH, SOL, XRP, DOGE, BNB, SUI, ADA, LINK, AVAX, gold and silver. It is context for your own decisions, never a signal.",
    keywords:
      "liquidation map heatmap liquidations levels clusters coinglass open interest oi leverage magnet",
    href: "/live",
  },
  {
    id: "market-desk",
    question: "What is the Market Context Desk?",
    answer:
      "Market Desk explains what is moving Bitcoin, Ethereum, Solana, gold and silver right now, one driver at a time: trend (moving averages and swing structure), momentum (RSI and the 24h move), positioning (open interest, taker buying vs selling and funding), liquidity (the biggest estimated liquidation clusters), macro (high-impact US releases, actual vs forecast) and crypto mood (Fear & Greed, Bitcoin dominance). Each driver shows which way its own evidence leans, with the numbers. There is deliberately no overall bullish or bearish call and no confidence score: it is context, never a signal. It also counts down to the next high-impact release and compares your open positions with their market's drivers. Recomputed every 15 minutes. Free shows Bitcoin; Pro and Premium every market.",
    keywords:
      "market desk context drivers bias bullish bearish sentiment macro news fomc cpi gold xau btc why is the market moving trend momentum funding",
    href: "/desk",
  },
  {
    id: "market-flow",
    question: "What is Market Flow (whale trades, liquidations and trend bias)?",
    answer:
      "Market Flow shows what big money and forced closes are doing, live from the public feeds of Binance, Bybit and OKX. Whale trades are single market orders above a size per coin (for example $250k on Bitcoin), after adding up all the fills of the order. Liquidations are real forced closes of long or short positions; Binance publishes at most one per coin per second, so its totals are a minimum. You can see the last 5, 15 or 30 minutes, 1 hour, 4 hours or a day, the net whale flow, liquidations by exchange, a chart and the full feed with filters. Trend bias shows the measured trend on the daily, 4-hour and 1-hour charts from closed candles: price against its 50 EMA, the 50 EMA against the 200 EMA, and the last break of swing structure; two agreeing set an up- or down-trend, otherwise it is a range. It describes the market now and is never a forecast or a signal. Free shows Bitcoin and Ethereum; Pro and Premium every market.",
    keywords:
      "whale trades whales big orders liquidations liquidated longs shorts flow bias trend daily 4 hour 1 hour timeframe 1d 4h 1h bullish bearish",
    href: "/flow",
  },
  {
    id: "scalp-cockpit",
    question: "What is the Scalp Cockpit, and how do I use it for a 5- or 15-minute trade?",
    answer:
      "Scalp Cockpit (Markets → Scalp Cockpit) puts everything WickMentor reads about one market on one screen: pick gold, Bitcoin, silver or any of the top coins, then 5m or 15m. At the top are warnings: a high-impact US release within 30 minutes or in the last 15, a high-impact headline in the last 30 minutes, very high activity, a wide spread, unusual volume, price sitting at today's high or low or the Asia range, extreme funding, or figures more than 3 minutes old. Then the readings, each judged by the rule written under it and counted as up, down or neutral: buying/selling strength on your timeframe, the next one up and 1H; what open interest did (long or short build-up, covering, unwinding); funding; price against today's VWAP; the order book within 0.25%; whale orders and real liquidations over your timeframe; and the 1-hour trend. The bar shows how many lean each way. Below: price, typical 5m and 15m ranges, activity, spread and link to Bitcoin; the nearest levels and the biggest estimated liquidation pools above and below price, with how many typical 5-minute ranges away they are; the order book; upcoming releases and recent high-impact headlines; the trend on 1D, 4H and 1H; and your own scalps on this market (trades held up to an hour in the last 180 days, on every exchange and broker including Exness gold) by session, with the current session highlighted. The Indicator gauges panel shows three dials like a chart's technical ratings, oscillators, moving averages and the summary, for 5m, 15m, 30m, 1H, 2H, 4H, 1D, 1W and 1M: 26 standard indicators (RSI, Stochastic, CCI, ADX, Awesome Oscillator, Momentum, MACD, Stochastic RSI, Williams %R, Bull Bear Power, Ultimate Oscillator, and simple and exponential averages of 10 to 200 plus Hull, VWMA and Ichimoku) each counted up, down or neutral by the published rule, with every reading listed underneath. Market mood comes from ADX: 25 or more is a trend (up or down by +DI and −DI), under 20 a range, between a weak trend. The gauges cover the 20 most traded coins, gold and silver, refresh every minute for 5m and 15m, every 5 minutes up to 2H and every 15 minutes for longer timeframes, and include the candle still forming. Under 'Alert me' you can ask to be told when a market has a number of readings one way, for example 'Gold, 7 or more readings either way on 5m, not while a news warning is up'. Alerts are checked every minute, fire when the condition starts holding, then rest for the time you choose; they arrive in Notifications and, if you switch it on in Settings, by email (Free keeps 1 alert, Pro 5, Premium 20). Every trade you open is also stamped with the Cockpit count of that minute, so 'Your scalps' shows how you did with the readings, against them, or when they were split, and each trade's page shows its 5m count at entry. The page refreshes by itself every 20 seconds. It is a count of readings, never a buy or sell call: the decision, stop and size stay yours. Some parts (whales and liquidations beyond BTC and ETH, the liquidation map beyond Bitcoin, trend beyond Bitcoin) are on Pro.",
    keywords:
      "scalp cockpit gauges technical ratings oscillators moving averages summary strong up down adx market mood ranging trending 2h 1w 1m alerts alert notify readings at entry with against one page everything scalping 5 minute 15 minute gold bitcoin silver readings tally warnings levels liquidation pools whales order book news my scalps record session",
    href: "/cockpit",
  },
  {
    id: "scalping",
    question:
      "What does the Scalping page show, and what do Strong buying and Strong selling mean?",
    answer:
      "Scalping (Markets → Scalping) shows the 100 most traded Binance futures, plus gold and silver on every plan, on six timeframes at once: 5 minutes, 15 minutes, 30 minutes, 1 hour, 4 hours and 1 day. 5m to 1H update every minute from 1-minute candles and live open interest; 4H and 1D every 5 minutes. For each timeframe a coin is rated Strong selling, Selling, Neutral, Buying or Strong buying from its buy pressure (market buys minus market sells, as a share of all trading). The bands are wider for short periods because a few minutes swing more than a day: on 5m it takes ±10% for Buying/Selling and ±25% for Strong; on 1D ±2% and ±5%; the full table is on the page. 'Short timeframes' counts how many of 5m, 15m, 30m and 1H lean each way. Volume shows trading against its usual pace (2.5× or more is flagged as unusual). VWAP is today's volume-weighted average price since 00:00 UTC, and the page shows how far price is above or below it. For the 20 most traded coins it also reads the order book every minute: the dollar value of buy and sell orders within 0.05%, 0.1%, 0.25%, 0.5% and 1% of price, the spread, and single orders at least 5 times the usual size (walls). It also shows the session now (Asia, London, New York), a red news-risk warning from 30 minutes before to 15 minutes after a high-impact US release (CPI, jobs report, Fed), the typical 5-minute, 15-minute and 1-hour ranges (ATR 14) with whether the market is quiet, normal, active or very active against its last 4 hours, and key levels: today's high and low, the Asia session range (00:00–07:00 UTC) and the 24-hour high and low, each with its distance from price. Gold and silver come from Binance's 24/7 gold and silver futures (XAUUSDT, XAGUSDT); a broker's XAUUSD price, for example Exness, can be a little apart, but the flow, ranges and levels describe the same market. The grid shows every coin on every timeframe, with filters for buying or selling on both 5m and 15m, unusual volume and the coins you hold. Strength describes what market orders did; it is not a forecast or a signal, and order-book orders can be pulled at any time. Free shows the top 20 coins; Pro and Premium all 100.",
    keywords:
      "scalping scalp gold xauusd silver atr range volatility session asia london new york news risk levels high low 5 minute 15 minute 30 minute 5m 15m 30m 1h strong buying strong selling neutral strength pressure delta vwap order book bids asks imbalance wall spread unusual volume relative volume timeframes",
    href: "/scalp",
  },
  {
    id: "order-flow",
    question: "What is Order Flow, and how do I read the gates and the four groups?",
    answer:
      "Order Flow scans the 100 most traded Binance futures and shows, for the last 5, 15 or 30 minutes, 1 hour (all updated every minute), 4 hours or 1 day (every 5 minutes), three things per coin from real exchange data: taker flow (market orders, the side that crossed the spread: net taker = market buys minus market sells, and buy pressure is that as a share of all trading), open interest (contracts still open, counted in coins so price moves don't change it) and the price change. In the 'flow through now' picture each line on the left is one coin's buy pressure building up over the period; at NOW every coin passes through the gate of the side that dominated (net buying or net selling, with the number of coins), and the twelve biggest flows each way end in cards with their dollar amount. The positioning map and the tables sort coins into four groups: Long build-up (price up, open interest up: new money behind the rise), Short build-up (price down, open interest up: new money pressing the fall), Short covering (price up, open interest down: shorts buying back) and Long unwinding (price down, open interest down: longs exiting). Moves smaller than a set size (for 5 minutes 0.15% in price or 0.2% in open interest, for 4 hours 0.6% or 1%) count as no clear flow. Each coin also gets a strength rating from Strong selling to Strong buying, as on the Scalping page. Funding is the rate of the next settlement. Click any coin for its price, open interest and buy pressure lines and links to the live chart. It is a record of what happened, never a forecast or a signal. Free shows the top 20 coins; Pro and Premium all 100.",
    keywords:
      "order flow taker buy sell pressure cvd delta open interest oi long build up short build up short covering long unwinding positioning gates net buying selling top coins funding money flow",
    href: "/orderflow",
  },
  {
    id: "world-news",
    question: "Where do I see breaking world news, FOMC and other market-moving headlines?",
    answer:
      "The News folder keeps each kind of news separate. Top stories lists every high-impact headline from all folders. World & geopolitics covers wars, attacks, pandemics, disasters, sanctions, tariffs and political crises (the kind of news that crashed markets in March 2020). Central banks & FOMC shows official Federal Reserve and ECB releases, newsroom coverage and the upcoming rate decisions. Economic calendar lists scheduled releases such as CPI and the jobs report, with economy headlines below. Crypto news covers ETFs, regulation, exchanges and hacks, and Markets & companies the rest. Every headline is rated High, Medium or Low by fixed rules (war, pandemic, rate decision, bank collapse or exchange hack = High) with a line on why it matters. High-impact headlines also appear on the dashboard and pop up on every page the moment they arrive, usually within 15 to 30 seconds. For High stories the app records how Bitcoin and gold moved in the 15 and 60 minutes after: a record, not a forecast. Reports of the same story from several newsrooms are shown once.",
    keywords:
      "news world breaking war pandemic covid fomc fed central bank ecb geopolitics headlines alerts crisis tariffs sanctions crypto news top stories",
    href: "/news/top",
  },
  {
    id: "menu-folders",
    question: "How is the menu organised?",
    answer:
      "Dashboard stands on its own. Everything else sits in five folders: Journal (Trades, Journal, Analytics, Reports, Goals), Coach and tools (AI Coach, Strategy Lab, Setup Alerts, Calculators), Markets (Live Charts, Trade Check, Market Desk, Scalp Cockpit, Scalping, Order Flow, Market Flow, Market Pulse), News (Top stories, World & geopolitics, Central banks & FOMC, Economic calendar, Crypto news, Markets & companies) and Account (Exchanges, Settings, Help). Every page inside a folder shows the folder's tabs at the top, so related pages are one click apart. On a computer you can close folders you rarely use; the folder of the page you are on always stays open. On a phone, “More” lists every page by folder.",
    keywords:
      "menu folders navigation sidebar tabs where is find page markets journal coach account",
    href: "/dashboard",
  },
  {
    id: "trade-check",
    question: "What is Trade Check, and why doesn't it just say long or short?",
    answer:
      "Trade Check puts every reading professional traders look at before a position on one page, per market: the trend on the weekly, daily, 4-hour and 1-hour charts; where price sits in last week's range and against the 200-day average; the Fear & Greed Index; funding, open interest, long/short ratios of all accounts and of Binance's top traders, taker buying and selling, whale orders and liquidation pools; the Coinbase premium (US spot demand), the futures basis and stablecoin supply; options skew, put/call ratio, implied volatility (DVOL) and max pain from Deribit; and the US dollar, 10-year yield, Nasdaq, S&P 500 and VIX from the St. Louis Fed (FRED). Each reading is judged by a fixed rule written next to it (for example, funding above 0.03% per settlement means longs are crowded and counts for shorts) and the page counts how many support longs, how many support shorts and how many are neutral. Risk flags warn about releases, crowded funding, big option expiries and volatility jumps. 'Your record in these conditions' shows how your own trades did when you entered with or against the daily and 4-hour trend, near releases and with crowded funding, and which of those groups a long or a short taken now would fall in. It deliberately never gives a single long/short call: a count of readings is context, markets often move against most of them, and the decision, the stop and the size stay yours. Macro rows need the free FRED key on the server. Free shows Bitcoin; Pro and Premium every market.",
    keywords:
      "trade check checklist before entry long short should i buy sell sentiment fear greed funding open interest long short ratio top traders coinbase premium basis stablecoin options skew put call max pain dvol volatility dxy dollar yields nasdaq vix macro record",
    href: "/check",
  },
  {
    id: "discipline-score",
    question: "What are the discipline score and the psychological tax?",
    answer:
      "On the dashboard, the discipline score (0–100) measures how you traded over the last 30 days: half of it is the share of clean trades with no habit flagged (revenge, FOMO, overtrading, holding losers and the rest), a quarter is how steady your position size was (between half and twice your normal size), and a quarter is the share of calm days without revenge trades or overtrading. It needs at least 5 trades, and the bars show the last 8 weeks. The psychological tax is the net result of every trade flagged with an emotional habit, each trade counted once, and what share of all your losses came from those trades. Journal your emotions and mistakes so more habits can be spotted.",
    keywords:
      "discipline score psychology psychological tax emotional habits cost revenge fomo tilt consistency",
    href: "/dashboard",
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
