import { EXCHANGE_CATALOG, type ExchangeId } from "@atc/shared";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

interface Step {
  title: string;
  body: ReactNode;
}

const NAME = "WickMentor";

/** Exchange-specific steps between "open API management" and "lock to our IPs". */
const CREATE_STEPS: Record<ExchangeId, Step[]> = {
  BINANCE: [
    {
      title: "Create a system-generated key",
      body: `Click Create API, choose "System generated", name it "${NAME}", and complete the security check.`,
    },
    {
      title: "Allow reading only",
      body: 'Click Edit restrictions. Leave only "Enable Reading" ticked. Every trading, withdrawal and transfer option must stay off.',
    },
  ],
  MEXC: [
    {
      title: "Create a key",
      body: `Click Create API Key and name it "${NAME}".`,
    },
    {
      title: "Allow viewing only",
      body: "Tick only the viewing permissions: the spot account, the futures account and futures orders. Leave every trading, transfer and withdrawal option unticked.",
    },
  ],
  KUCOIN: [
    {
      title: "Create a key with a passphrase",
      body: `Click Create API, name it "${NAME}" and choose an API passphrase. Write the passphrase down: you will paste it below, and KuCoin cannot show it again.`,
    },
    {
      title: "Allow General only",
      body: 'Leave only "General" ticked. Spot, Margin, Futures, Unified, Earn, transfer and withdrawal permissions must stay off.',
    },
  ],
  // MetaTrader brokers use their own guide (metatraderSteps); no API key is created.
  EXNESS: [],
  BINGX: [
    {
      title: "Create a key",
      body: `Click Create API, name it "${NAME}", and complete the security check. New BingX keys start as read-only.`,
    },
    {
      title: "Keep it read-only",
      body: 'Check that only "Read" is ticked. Spot Trading, Perpetual Futures Trading, Withdraw and transfer options must stay off.',
    },
  ],
};

function ipStep(exchange: ExchangeId, egressIps: string[]): Step | null {
  if (egressIps.length === 0) return null;
  const expiry =
    exchange === "MEXC"
      ? " MEXC also expires keys that have no IP lock; locked keys last longer."
      : "";
  return {
    title: "Lock the key to our servers",
    body: (
      <>
        Choose to restrict access to trusted IPs and add{" "}
        {egressIps.map((ip, i) => (
          <span key={ip}>
            <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-ink">{ip}</code>
            {i < egressIps.length - 1 ? " and " : ""}
          </span>
        ))}
        . Even if the key leaked, it would not work anywhere else.{expiry}
      </>
    ),
  };
}

function copyStep(exchange: ExchangeId): Step {
  const { name, needsPassphrase } = EXCHANGE_CATALOG[exchange];
  return {
    title: needsPassphrase ? "Copy the key, secret and passphrase" : "Copy both keys",
    body: needsPassphrase
      ? `Paste the API Key, the Secret Key and your passphrase into the form. ${name} shows the Secret Key only once.`
      : `Paste the API Key and the Secret Key into the form. ${name} shows the Secret Key only once.`,
  };
}

const linkClass =
  "inline-flex items-center gap-1 text-ink underline decoration-rule underline-offset-4 hover:decoration-coach";

/** MetaTrader brokers: the account login plus an investor (read-only) password. */
function metatraderSteps(exchange: ExchangeId): Step[] {
  const info = EXCHANGE_CATALOG[exchange];
  return [
    {
      title: "Find your account number and server",
      body: (
        <>
          Sign in to your{" "}
          <a
            href={info.apiManagementUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            {info.name} Personal Area
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>{" "}
          and open the MetaTrader account you trade with. Its details show the account number and
          the server name, for example{" "}
          <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-ink">
            {info.serverExample}
          </code>
          .
        </>
      ),
    },
    {
      title: "Set an investor (read-only) password",
      body: "In MetaTrader on a computer, open Tools → Options → Server, click Change, choose the investor (read-only) password, and set a new one. If your Personal Area offers “Change investor password” for this account, you can use that instead. An investor password can only view the account: it cannot trade, deposit or withdraw.",
    },
    {
      title: "Paste the details",
      body: "Choose MetaTrader 5 or 4, then paste the account number, the server and the investor password into the form. Never use your trading password: we refuse it and delete it.",
    },
  ];
}

/** Step-by-step key creation. A real sequence, so it is numbered. */
export function KeyGuide({ exchange, egressIps }: { exchange: ExchangeId; egressIps: string[] }) {
  const info = EXCHANGE_CATALOG[exchange];
  const steps: Step[] =
    info.kind === "METATRADER"
      ? metatraderSteps(exchange)
      : [
          {
            title: "Open API Management",
            body: (
              <>
                Sign in to {info.name} and open{" "}
                <a
                  href={info.apiManagementUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-ink underline decoration-rule underline-offset-4 hover:decoration-coach"
                >
                  API Management
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
                .
              </>
            ),
          },
          ...CREATE_STEPS[exchange],
          ...[ipStep(exchange, egressIps)].filter((s): s is Step => s !== null),
          copyStep(exchange),
        ];

  return (
    <div className="grid gap-5">
      <ol className="grid gap-5">
        {steps.map((step, i) => (
          <li key={step.title} className="grid grid-cols-[1.75rem_1fr] gap-3">
            <span className="figures flex h-7 w-7 items-center justify-center rounded-full border border-rule text-sm text-ink-muted">
              {i + 1}
            </span>
            <div>
              <h3 className="text-sm font-medium">{step.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      {info.historyLimitNote && (
        <p className="rounded-[var(--radius-control)] bg-raised px-4 py-3 text-sm text-ink-muted">
          {info.historyLimitNote}
        </p>
      )}
    </div>
  );
}
