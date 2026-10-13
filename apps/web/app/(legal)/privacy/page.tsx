export const metadata = { title: "Privacy policy" };

/** Template reflecting how the product actually handles data. Have it reviewed by a lawyer before launch. */
export default function Privacy() {
  return (
    <>
      <h1>Privacy policy</h1>
      <p>Last updated: [date]. [Company legal name], [address] ("we") operates WickMentor.</p>
      <h2>What we collect</h2>
      <p>
        Account details (name, email) through our sign-in provider; read-only exchange API keys you
        give us; for MetaTrader brokers, your account number, server and investor (read-only)
        password; your trading history downloaded with them (trades, fees, funding or swaps,
        positions); what you write in your journal; your chats with the AI coach; and basic
        technical logs (IP address, browser) for security.
      </p>
      <h2>How we protect exchange keys</h2>
      <p>
        We only accept read-only keys and reject keys that can trade or withdraw, and re-check every
        day. Keys are encrypted with AES-256-GCM using a separate key for each record, and only the
        sync service can decrypt them.
      </p>
      <p>
        For MetaTrader brokers (such as Exness) we only accept the investor password, which cannot
        trade or move funds; a trading password is refused and deleted. It is passed to MetaApi,
        which runs the read-only MetaTrader connection, and deleted from our database once the
        connection is made.
      </p>
      <h2>How we use your data</h2>
      <p>
        To build your journal, statistics, reports and coaching. AI features send the relevant
        figures and journal notes to our AI provider (Anthropic) to generate text; they are not used
        to train its models under our agreement. We do not sell your data.
      </p>
      <h2>Processors</h2>
      <p>
        Clerk (sign-in), Neon (database), Railway (servers), Vercel (website), Anthropic (AI),
        Paddle (payments, as merchant of record), Resend (email), MetaApi (read-only MetaTrader
        connections, if you connect a MetaTrader broker), and Sentry (error reports, without your
        personal data) if enabled.
      </p>
      <h2>Your choices</h2>
      <p>
        You can disconnect an exchange at any time (its key is deleted), export all your trades
        (Reports), change email preferences (Settings), and delete your account by contacting
        [support email]. We keep billing records as the law requires.
      </p>
      <h2>Contact</h2>
      <p>[support email]</p>
    </>
  );
}
