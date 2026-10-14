/**
 * Free public tools (no sign-in). Each one is a page Google can index, answering a question
 * traders search for, and ends by inviting them to get the same insight automatically.
 */
export interface PublicTool {
  slug: string;
  /** Short name in cards and navigation. */
  name: string;
  /** Page heading and search title. */
  title: string;
  /** Search result description (under ~155 characters). */
  description: string;
  intro: string;
  howItWorks: string[];
  faq: Array<{ q: string; a: string }>;
}

export const PUBLIC_TOOLS: PublicTool[] = [
  {
    slug: "trade-grader",
    name: "Trade grader",
    title: "Free Trade Grader: score your futures trade before you enter",
    description:
      "Enter entry, stop, target, size and leverage. Get an A–F grade for risk, reward, leverage, liquidation safety and fees, with tips to fix it.",
    intro:
      "Most blown accounts come from a handful of bad plans: too much size, a stop beyond liquidation, or a target that barely pays the fees. Grade your plan in seconds before you click buy or sell.",
    howItWorks: [
      "Risk per trade (30 points): the money lost at your stop, fees included, as a share of your account. 1% or less scores best; over 3% caps the grade at D and over 5% means an F.",
      "Reward vs risk (30 points): what you make at the target versus what you lose at the stop, after fees. 1 : 2 or better scores well.",
      "Leverage (15 points): your position size compared with your whole account, not just the leverage setting.",
      "Liquidation safety (15 points): whether your stop sits safely before the estimated liquidation price. A stop beyond liquidation caps the grade at D.",
      "Fees (10 points): how much of the profit the exchange keeps if the target is hit.",
    ],
    faq: [
      {
        q: "Is this grade financial advice?",
        a: "No. It checks the risk maths of a plan you already have. It does not say whether the market will go up or down.",
      },
      {
        q: "How is the liquidation price estimated?",
        a: "For isolated margin: entry × (1 − 1/leverage + 0.5%) for longs and entry × (1 + 1/leverage − 0.5%) for shorts. Exchanges differ slightly, so keep your stop well before it.",
      },
      {
        q: "What fee should I enter?",
        a: "Your exchange's fee per side. Taker (market) orders are often around 0.04–0.06%; maker (limit) orders are usually lower.",
      },
    ],
  },
  {
    slug: "position-size-calculator",
    name: "Position size calculator",
    title: "Position Size Calculator for Crypto Futures",
    description:
      "Work out exactly how much to buy so a stopped-out trade costs your planned risk. Free position size calculator with leverage and margin.",
    intro:
      "Position sizing is the single biggest lever on your survival as a trader. Choose how much of your account to risk, set your stop, and get the exact quantity, position value and margin.",
    howItWorks: [
      "Money at risk = account balance × risk %.",
      "Quantity = money at risk ÷ distance from entry to stop.",
      "Position value = quantity × entry price; margin needed = position value ÷ leverage.",
    ],
    faq: [
      {
        q: "Does leverage change how much I risk?",
        a: "No. With a fixed stop, your risk depends on size and stop distance. Leverage only changes the margin the exchange locks up.",
      },
      {
        q: "What risk per trade should I use?",
        a: "Many professional traders risk 0.5–1% per trade so that a long losing streak cannot destroy the account.",
      },
    ],
  },
  {
    slug: "risk-reward-calculator",
    name: "Risk/reward calculator",
    title: "Risk Reward Ratio Calculator",
    description:
      "Calculate your risk-to-reward ratio and the win rate you need to break even, from entry, stop loss and take profit.",
    intro:
      "A good trade is not just one that wins; it pays more when right than it costs when wrong. Enter your levels to see the ratio and the break-even win rate.",
    howItWorks: [
      "Risk = distance from entry to stop; reward = distance from entry to target.",
      "Ratio = reward ÷ risk.",
      "Break-even win rate = 1 ÷ (1 + ratio).",
    ],
    faq: [
      {
        q: "What is a good risk-reward ratio?",
        a: "1 : 2 or better is a common target: you can be wrong two times out of three and still not lose money (before fees).",
      },
    ],
  },
  {
    slug: "profit-calculator",
    name: "Futures profit calculator",
    title: "Crypto Futures Profit Calculator (with fees)",
    description:
      "Net profit or loss of a long or short futures trade after entry and exit fees, plus return on margin.",
    intro:
      "See what a trade really makes after the exchange takes its fees on both entry and exit.",
    howItWorks: [
      "Gross result = (exit − entry) × quantity for longs, the reverse for shorts.",
      "Fees are charged on the order value at entry and at exit.",
      "Net result = gross result − both fees.",
    ],
    faq: [
      {
        q: "Why is my profit smaller than the price move?",
        a: "Fees are paid twice, on the way in and on the way out, and on the full position value, not your margin.",
      },
    ],
  },
  {
    slug: "expectancy-calculator",
    name: "Expectancy calculator",
    title: "Trading Expectancy Calculator",
    description:
      "Find out what each trade is worth on average from your win rate, average win and average loss.",
    intro:
      "Expectancy tells you whether your system makes money over many trades. Positive expectancy is the whole game.",
    howItWorks: ["Expectancy = win rate × average win − loss rate × average loss."],
    faq: [
      {
        q: "Can I be profitable with a low win rate?",
        a: "Yes, if your average win is large enough compared with your average loss. Expectancy shows it.",
      },
    ],
  },
  {
    slug: "break-even-win-rate-calculator",
    name: "Break-even win rate",
    title: "Break-Even Win Rate Calculator",
    description: "The minimum win rate you need not to lose money at a given reward-to-risk ratio.",
    intro:
      "Every risk-reward ratio comes with a minimum win rate. Know yours before judging a strategy.",
    howItWorks: ["Required win rate = 1 ÷ (1 + reward-to-risk)."],
    faq: [
      {
        q: "Does this include fees?",
        a: "No. Fees raise the real break-even win rate a little; the Trade grader includes them.",
      },
    ],
  },
  {
    slug: "kelly-criterion-calculator",
    name: "Kelly criterion",
    title: "Kelly Criterion Calculator for Traders",
    description:
      "The mathematically optimal share of your account to risk, from win rate and reward-to-risk, plus the safer half-Kelly.",
    intro:
      "The Kelly formula gives the bet size that grows an account fastest in theory. In practice traders use a fraction of it.",
    howItWorks: [
      "Kelly % = win rate − (loss rate ÷ reward-to-risk). Half-Kelly halves it for safety.",
    ],
    faq: [
      {
        q: "Should I risk the full Kelly amount?",
        a: "Usually not: full Kelly produces large drawdowns and assumes your win rate is known exactly. Quarter to half Kelly is common.",
      },
    ],
  },
  {
    slug: "drawdown-recovery-calculator",
    name: "Drawdown recovery",
    title: "Drawdown Recovery Calculator",
    description:
      "How much you need to gain to recover from a loss. A 50% drawdown needs a 100% gain.",
    intro: "Losses and gains are not symmetrical. See how deep a hole a drawdown really is.",
    howItWorks: ["Gain needed = 1 ÷ (1 − drawdown) − 1."],
    faq: [
      {
        q: "Why does a 50% loss need a 100% gain?",
        a: "After losing half, you have half the money left, so it must double to get back to where you started.",
      },
    ],
  },
  {
    slug: "risk-of-ruin-calculator",
    name: "Risk of ruin",
    title: "Risk of Ruin Calculator",
    description:
      "The chance of losing a given share of your account from your win rate, reward-to-risk and risk per trade.",
    intro:
      "Even a winning system can blow up with too much risk per trade. Estimate the probability of hitting your maximum drawdown.",
    howItWorks: [
      "Uses the classic gambler's-ruin approximation: your edge per trade (win rate × reward − loss rate) and its variability, measured against how many losing trades it takes to reach the ruin level at your risk per trade.",
    ],
    faq: [
      {
        q: "How do I lower my risk of ruin?",
        a: "Risk less per trade. It is the most powerful input: halving risk per trade cuts the chance of ruin dramatically.",
      },
    ],
  },
  {
    slug: "monte-carlo-simulator",
    name: "Monte Carlo simulator",
    title: "Trading Monte Carlo Simulator",
    description:
      "Simulate thousands of possible equity curves for your strategy to see likely profits, drawdowns and losing streaks.",
    intro:
      "Your next 100 trades will not look like your last 100. A Monte Carlo simulation shows the range of outcomes your strategy can produce.",
    howItWorks: [
      "Draws random sequences of wins and losses with your win rate and payoff, many times over, and reports the typical and worst outcomes.",
    ],
    faq: [
      {
        q: "How should I read the results?",
        a: "Look at the range, not one number: the weak (10th percentile) outcome and the typical drawdown show what you must be able to sit through.",
      },
    ],
  },
];

export const toolBySlug = (slug: string) => PUBLIC_TOOLS.find((t) => t.slug === slug) ?? null;

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.wickmentor.com").replace(
  /\/$/,
  "",
);
