import Link from "next/link";
import { ImportForm } from "@/features/trades/import-form";

export const metadata = { title: "Import trades" };

const COLUMNS: [string, string, boolean][] = [
  ["exchange", "BINANCE, BYBIT, OKX, MEXC, KUCOIN or BINGX", true],
  ["symbol", "The futures pair, e.g. BTCUSDT", true],
  ["direction", "LONG or SHORT", true],
  ["opened_at", "When you opened, e.g. 2026-03-02 09:15:00 (UTC)", true],
  ["closed_at", "When you fully closed", true],
  ["entry_price", "Average entry price", true],
  ["exit_price", "Average exit price", true],
  ["quantity", "Size in coins (not contracts or USDT)", true],
  ["fees", "Trading fees paid, as a positive number", false],
  ["funding", "Funding: positive received, negative paid", false],
  ["net_pnl", "Your final result. Leave empty to calculate it", false],
  ["leverage", "e.g. 10", false],
];

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/trades" className="text-sm text-ink-muted hover:text-ink">
        Trades
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Import older trades</h1>
      <p className="mt-2 max-w-[65ch] text-sm text-ink-muted">
        Exchanges only share about three months of history with apps like ours. To bring in older
        trades, fill in our template (one row per closed trade) and upload it. Uploading the same
        file twice never creates duplicates.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section
          aria-labelledby="columns-heading"
          className="rounded-[var(--radius-surface)] surface p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="columns-heading" className="font-semibold">
              Template columns
            </h2>
            <a
              href="/trades/import/template"
              className="text-sm text-ink underline decoration-rule underline-offset-4 hover:decoration-coach"
            >
              Download template
            </a>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {COLUMNS.map(([name, meaning, required]) => (
                  <tr key={name} className="border-b border-rule last:border-0">
                    <th
                      scope="row"
                      className="py-2 pr-4 text-left align-top font-mono text-xs font-normal text-ink"
                    >
                      {name}
                    </th>
                    <td className="py-2 text-ink-muted">
                      {meaning}
                      {!required && <span className="text-ink-faint"> (optional)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section
          aria-labelledby="upload-heading"
          className="rounded-[var(--radius-surface)] surface p-5 sm:p-6"
        >
          <h2 id="upload-heading" className="mb-5 font-semibold">
            Upload your file
          </h2>
          <ImportForm />
          <p className="mt-6 text-xs text-ink-faint">
            Trades that fall inside history we already sync from a connected exchange are skipped,
            so nothing is counted twice.
          </p>
        </section>
      </div>
    </div>
  );
}
