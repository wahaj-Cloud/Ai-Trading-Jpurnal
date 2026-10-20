import {
  CALIBRATION_WINDOWS,
  type ScalpCalibrationDto,
  STRENGTH_LABEL,
  STRENGTHS,
  signedPct,
} from "@atc/shared";
import Link from "next/link";
import { Panel } from "@/features/analytics/metric";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

export const metadata = { title: "Scalp thresholds" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const pct = (v: number | null, d = 1) => (v === null ? "—" : `${(v * 100).toFixed(d)}%`);
const num = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined ? "—" : v.toFixed(d);

/**
 * Admin: review of the Scalp Cockpit strength thresholds against the minutes recorded by the
 * worker. Shows the real spread of buy pressure, how often each label comes up with the current
 * thresholds, suggested thresholds (Neutral about half the time, Strong about one minute in ten)
 * and the average price move in the 15 minutes after each label. Changing the thresholds is a
 * code change (STRENGTH_THRESHOLDS in packages/shared/src/orderflow.ts).
 */
export default async function CalibrationPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const days = [1, 3, 7].includes(Number(raw.days)) ? Number(raw.days) : 7;
  const c = await apiFetch<ScalpCalibrationDto>(`/v1/admin/scalp-calibration?days=${days}`);
  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Scalp thresholds review</h1>
          <p className="max-w-3xl text-sm text-ink-muted">
            How buy pressure really spread over the recorded minutes, and whether the Strong /
            Buying / Neutral / Selling bands fit it. Target: Neutral about half the time, Strong
            about 1 minute in 10.
          </p>
        </div>
        <nav className="flex gap-2 text-sm">
          {[1, 3, 7].map((d) => (
            <Link
              key={d}
              href={`/admin/calibration?days=${d}`}
              className={cn(
                "rounded-full border px-3 py-1",
                d === days ? "border-coach/60 bg-coach/15" : "border-rule text-ink-muted",
              )}
            >
              {d} day{d > 1 ? "s" : ""}
            </Link>
          ))}
        </nav>
      </header>
      <p className="text-sm text-ink-muted">
        {c.minutes > 0
          ? `${c.minutes} sampled minutes (every 5th) from ${new Date(c.from ?? "").toLocaleString("en")} to ${new Date(c.to ?? "").toLocaleString("en")}.`
          : "No minutes recorded yet. The worker records one row a minute; come back after a few days."}
        {c.minutes > 0 &&
          c.minutes < 1000 &&
          " Less than about 3.5 days: treat the suggestions as early."}
      </p>
      {c.groups.map((g) => (
        <Panel key={g.key} title={g.label}>
          <div className="overflow-x-auto">
            <table className="figures w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-faint">
                  <th className="pb-2 font-medium">Window</th>
                  <th className="pb-2 font-medium">Samples</th>
                  <th className="pb-2 font-medium">|Pressure| p50 / p75 / p90 / p95</th>
                  <th className="pb-2 font-medium">Now: lean / strong</th>
                  <th className="pb-2 font-medium">Suggested</th>
                  {STRENGTHS.map((s) => (
                    <th key={s} className="pb-2 text-right font-medium">
                      {STRENGTH_LABEL[s]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.windows.map((w) => {
                  const p = w.absPercentiles;
                  const off =
                    w.suggested &&
                    (Math.abs(w.suggested.lean - w.current.lean) / w.current.lean > 0.3 ||
                      Math.abs(w.suggested.strong - w.current.strong) / w.current.strong > 0.3);
                  return (
                    <tr key={w.window} className="border-t border-rule">
                      <td className="py-2 font-medium">{w.window}</td>
                      <td>{w.samples.toLocaleString("en")}</td>
                      <td>
                        {p
                          ? `${num(p.p50, 1)} / ${num(p.p75, 1)} / ${num(p.p90, 1)} / ${num(p.p95, 1)}`
                          : "—"}
                      </td>
                      <td>
                        ±{w.current.lean} / ±{w.current.strong}
                      </td>
                      <td className={cn(off && "font-semibold text-[#f59e0b]")}>
                        {w.suggested ? `±${w.suggested.lean} / ±${w.suggested.strong}` : "—"}
                      </td>
                      {STRENGTHS.map((s) => (
                        <td key={s} className="text-right">
                          {pct(w.shareNow[s], 0)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <h3 className="mt-5 mb-2 text-sm font-semibold">Price 15 minutes after each label</h3>
          <div className="overflow-x-auto">
            <table className="figures w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-faint">
                  <th className="pb-2 font-medium">Window</th>
                  {STRENGTHS.map((s) => (
                    <th key={s} className="pb-2 text-right font-medium">
                      {STRENGTH_LABEL[s]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.windows
                  .filter((w) => CALIBRATION_WINDOWS.includes(w.window))
                  .map((w) => (
                    <tr key={w.window} className="border-t border-rule">
                      <td className="py-2 font-medium">{w.window}</td>
                      {w.forward15m.map((f) => (
                        <td key={f.strength} className="text-right">
                          {f.samples > 0 ? (
                            <>
                              <span className={(f.avgPct ?? 0) >= 0 ? "text-profit" : "text-loss"}>
                                {f.avgPct === null ? "—" : signedPct(f.avgPct, 3)}
                              </span>
                              <span className="block text-xs text-ink-faint">
                                up {pct(f.upShare, 0)} · n {f.samples.toLocaleString("en")}
                              </span>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            Average price change 15 minutes after the label and the share of times price was higher.
            For judging the labels only: a small edge in averages is not a trading signal.
          </p>
        </Panel>
      ))}
      <p className="text-xs text-ink-faint">
        To change the thresholds, send the suggested numbers to your developer: they live in
        STRENGTH_THRESHOLDS (packages/shared/src/orderflow.ts) and every test checks them.
      </p>
    </div>
  );
}
