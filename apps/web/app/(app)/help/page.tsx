import { BEHAVIOURS, SESSIONS } from "@atc/shared";
import type { ReactNode } from "react";

export const metadata = { title: "Help" };

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-h`}
      className="scroll-mt-20 rounded-[var(--radius-surface)] surface p-5 sm:p-6"
    >
      <h2 id={`${id}-h`} className="font-semibold">
        {title}
      </h2>
      <div className="mt-3 grid gap-3 text-sm text-ink-muted">{children}</div>
    </section>
  );
}

function Terms({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-3">
      {items.map(([term, text]) => (
        <div key={term}>
          <dt className="font-medium text-ink">{term}</dt>
          <dd>{text}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Plain-language definitions of every number and label the app shows. */
export default function HelpPage() {
  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">How the numbers work</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every figure is calculated by fixed rules from your exchange data. The AI coach explains
          these figures; it never invents them.
        </p>
      </header>

      <Section id="metrics" title="Performance">
        <Terms
          items={[
            [
              "Net P&L",
              "Profit or loss after trading fees and funding payments, on closed trades.",
            ],
            [
              "Win rate",
              "Winning trades ÷ (winning + losing trades). Break-even trades are left out.",
            ],
            ["Profit factor", "Total won ÷ total lost. Above 1 means you make more than you lose."],
            [
              "Expectancy",
              "Average result per trade: what one more trade is worth on your record.",
            ],
            ["Reward : risk", "Average win ÷ average loss."],
            ["Max drawdown", "The largest fall of your cumulative profit from a previous high."],
            [
              "R multiple",
              "Result ÷ the money you planned to risk (entry to your journal stop). +2R means you made twice what you risked.",
            ],
            [
              "Days and hours",
              "Always in your timezone (Settings). Coin-margined trades that pay in BTC or other coins are listed but not added to USD totals.",
            ],
            [
              "Sessions",
              Object.values(SESSIONS)
                .map((s) => `${s.label} ${s.hours}`)
                .join(" · "),
            ],
          ]}
        />
      </Section>

      <Section id="grades" title="Trade grades">
        <p>
          Grades reward process more than outcome. Every trade starts at 60 points. A planned stop
          (+10), a planned reward of 2R or more (+5), a named setup (+3) and your own rating add
          points. Logged mistakes (−6 each), detected behaviours (−3 to −12) and fees above 30% of
          the gain remove points. The result counts too, but capped: −15 to +20 by R multiple, or ±8
          when no stop was logged.
        </p>
        <p>A+ 90+ · A 80+ · B 68+ · C 55+ · D 40+ · F below 40.</p>
      </Section>

      <Section id="behaviours" title="Behaviours the coach detects">
        <Terms
          items={Object.values(BEHAVIOURS).map((b) => [b.label, b.about] as [string, string])}
        />
        <p>
          Detection compares each trade with your own normal (your typical position size, holding
          time and trades per day over the previous 30 days) and with what you tagged in your
          journal.
        </p>
      </Section>

      <Section id="strategy" title="Strategy analysis">
        <p>
          Charts use candles from the exchange you traded on, on a timeframe matched to how long you
          held: under 2 hours 5-minute candles, under 12 hours 15-minute, under 3 days 1-hour,
          otherwise 4-hour. Entry readings only use candles that had closed before you entered.
        </p>
        <Terms
          items={[
            ["EMA 20 / 50 / 200", "Exponential moving averages of closing prices."],
            [
              "RSI (14)",
              "Relative Strength Index with Wilder smoothing. 70+ is stretched up, 30− stretched down.",
            ],
            ["VWAP", "Volume-weighted average price, restarting at 00:00 UTC each day."],
            [
              "ATR stretch",
              "Distance from the 20 EMA measured in Average True Ranges. More than 2.5 ATR in your direction (or RSI 75+ for longs, 25− for shorts) counts as chasing.",
            ],
            [
              "Swing high / low",
              "A candle whose high (low) is the extreme of the two candles on each side.",
            ],
            [
              "BOS",
              "Break of structure: a close beyond the latest swing, in the direction of the trend.",
            ],
            [
              "CHOCH",
              "Change of character: the first close beyond the latest swing against the trend.",
            ],
            [
              "Fair value gap",
              "Three-candle imbalance: candle 1's high below candle 3's low (bullish), or the reverse.",
            ],
            [
              "Order block",
              "The last opposite-colour candle before the move that broke structure.",
            ],
            [
              "Breaker block",
              "An order block that failed after the move first made a further high (low): a liquidity grab, then reversal.",
            ],
            [
              "Mitigation block",
              "An order block that failed after a lower high (higher low): the move ran out without a new extreme.",
            ],
            [
              "Liquidity",
              "Equal highs (buy-side) or equal lows (sell-side) where stops rest; 'swept' when price trades through them.",
            ],
            [
              "Premium / discount",
              "Where price sits in the latest swing range: above 55% premium, below 45% discount.",
            ],
            ["Support / resistance", "Prices where two or more swings clustered."],
            [
              "Best / worst move",
              "The most the trade was in profit and in loss while open; 'kept' is the share of the best move you held at exit.",
            ],
          ]}
        />
      </Section>

      <Section id="ai" title="The AI coach">
        <p>
          Reviews, daily and weekly notes and chat answers are written by an AI model from the
          figures above, your journal and the market analysis. It coaches your process; it does not
          give trading signals or financial advice, and it can make mistakes, so check anything
          important against your numbers.
        </p>
      </Section>
    </div>
  );
}
