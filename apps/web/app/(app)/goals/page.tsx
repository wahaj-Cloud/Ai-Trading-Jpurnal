import type { GoalDto, RiskLimits, RiskStatusDto } from "@atc/shared";
import { Panel } from "@/features/analytics/metric";
import { AddGoalForm, DeleteGoalButton, RiskLimitsForm } from "@/features/goals/forms";
import { GoalRow, RiskBanner } from "@/features/goals/views";
import { apiFetch } from "@/lib/api";

export const metadata = { title: "Goals" };

export default async function GoalsPage() {
  const [limits, status, goals] = await Promise.all([
    apiFetch<RiskLimits>("/v1/risk-limits"),
    apiFetch<RiskStatusDto>("/v1/risk-status"),
    apiFetch<GoalDto[]>("/v1/goals"),
  ]);
  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Goals and risk limits</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Limits are checked after every sync; you get a warning at 80% and an alert when a limit is
          reached. Goals are tracked every week or month.
        </p>
      </header>
      <RiskBanner status={status} />
      <Panel title="Daily risk limits">
        <RiskLimitsForm limits={limits} />
        {status.rules.length > 0 && (
          <ul className="mt-5 grid gap-1 text-sm text-ink-muted">
            {status.rules.map((r) => (
              <li key={r.rule}>
                <span className="text-ink">{r.label}:</span> {r.message}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Goals">
        {goals.length > 0 ? (
          <ul className="mb-6 grid gap-3">
            {goals.map((g) => (
              <GoalRow key={g.id} goal={g} action={<DeleteGoalButton id={g.id} />} />
            ))}
          </ul>
        ) : (
          <p className="mb-6 text-sm text-ink-muted">
            Set a weekly or monthly goal, for example "review 80% of trades" or "at most 30 trades a
            week". Process goals build habits faster than profit goals.
          </p>
        )}
        <AddGoalForm />
      </Panel>
    </div>
  );
}
