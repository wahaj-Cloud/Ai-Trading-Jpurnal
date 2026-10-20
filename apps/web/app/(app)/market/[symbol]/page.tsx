import {
  fixedMinus,
  PULSE_DISCLAIMER,
  PULSE_LINKS,
  PULSE_WINDOWS,
  type PulseSymbolDto,
} from "@atc/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Panel } from "@/features/analytics/metric";
import { LineChart } from "@/features/charts/line-chart";
import { ApiError, apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

export const metadata = { title: "Market Pulse" };

const signedPct = (v: number) => {
  const shown = Number((v * 100).toFixed(2));
  return `${shown > 0 ? "+" : shown < 0 ? "−" : ""}${Math.abs(shown).toFixed(2)}%`;
};

export default async function PulseSymbolPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = await params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol)) notFound();
  let data: PulseSymbolDto;
  try {
    data = await apiFetch<PulseSymbolDto>(`/v1/market/pulse/${symbol}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
      return (
        <div className="mx-auto grid max-w-3xl gap-4">
          <Link href="/market" className="text-sm text-ink-muted hover:text-ink">
            ← Market Pulse
          </Link>
          <p className="surface rounded-[var(--radius-surface)] p-6 text-sm text-ink-muted">
            {err.body?.message ?? "This coin is not available."}
          </p>
        </div>
      );
    }
    throw err;
  }
  return (
    <div className="mx-auto grid max-w-5xl gap-6 grid-cols-[minmax(0,1fr)]">
      <header>
        <Link href="/market" className="text-sm text-ink-muted hover:text-ink">
          ← Market Pulse
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {symbol.replace(/USDT$/, "")} vs BTC
        </h1>
      </header>
      <div className="grid gap-4 sm:grid-cols-3">
        {PULSE_WINDOWS.map((w) => {
          const r = data.windows[w];
          return (
            <section key={w} className="surface rounded-[var(--radius-surface)] p-4">
              <p className="text-xs text-ink-muted">{w}</p>
              {r ? (
                <>
                  <p className="mt-1 font-semibold">{PULSE_LINKS[r.link]}</p>
                  <dl className="figures mt-2 grid gap-1 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">Correlation</dt>
                      <dd>{fixedMinus(r.corr, 2)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">Beta</dt>
                      <dd>{fixedMinus(r.beta, 2)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">vs BTC</dt>
                      <dd className={cn(r.relStrength >= 0 ? "text-profit" : "text-loss")}>
                        {signedPct(r.relStrength)}
                      </dd>
                    </div>
                  </dl>
                </>
              ) : (
                <p className="mt-1 text-sm text-ink-faint">
                  {w === "24h" ? "Not enough data" : "Pro"}
                </p>
              )}
            </section>
          );
        })}
      </div>
      <Panel title="24h correlation, last 7 days">
        {data.history.length > 1 ? (
          <LineChart
            label={`${symbol} 24-hour correlation to BTC, hourly`}
            zeroLine
            format="ratio"
            series={[
              {
                name: "Correlation to BTC",
                colorVar: "--color-coach",
                fallback: "#7c8cff",
                points: data.history.map((h) => ({ t: Date.parse(h.t) / 1000, v: h.corr })),
              },
            ]}
          />
        ) : (
          <p className="text-sm text-ink-muted">History builds up hour by hour.</p>
        )}
        <p className="mt-2 text-xs text-ink-faint">
          Above 0.7: moves with BTC. Between −0.3 and 0.3: moves on its own. Below −0.3: tends to
          move the other way.
        </p>
      </Panel>
      <p className="text-xs text-ink-faint">{PULSE_DISCLAIMER}</p>
    </div>
  );
}
