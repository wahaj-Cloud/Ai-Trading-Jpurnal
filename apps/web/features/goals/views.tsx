import type { GoalDto, RiskStatusDto } from "@atc/shared";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";

const STATE = {
  ON_TRACK: { label: "On track", cls: "text-profit" },
  MET: { label: "Met", cls: "text-profit" },
  BEHIND: { label: "Behind", cls: "text-coach" },
  FAILED: { label: "Missed", cls: "text-loss" },
} as const;

export function GoalRow({ goal, action }: { goal: GoalDto; action?: React.ReactNode }) {
  const pct = Math.min(1, goal.progress);
  const lower = goal.metric === "MAX_TRADES";
  return (
    <li className="grid gap-2 rounded-[var(--radius-control)] border border-rule px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {goal.label} · {goal.period === "WEEK" ? "weekly" : "monthly"}
        </p>
        <div className="flex items-center gap-2">
          <span className={cn("text-xs font-medium", STATE[goal.state].cls)}>
            {STATE[goal.state].label}
          </span>
          {action}
        </div>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-raised"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
        aria-label={`${goal.label}: ${Math.round(pct * 100)}%`}
      >
        <div
          className={cn(
            "h-full rounded-full",
            goal.state === "FAILED" || (lower && pct >= 1)
              ? "bg-loss"
              : goal.state === "BEHIND"
                ? "bg-coach"
                : "bg-profit",
          )}
          style={{ width: `${Math.max(2, pct * 100)}%` }}
        />
      </div>
      <p className="text-xs text-ink-muted">{goal.message}</p>
    </li>
  );
}

/** Banner for today's limits: shown only when something needs attention. */
export function RiskBanner({ status }: { status: RiskStatusDto | null }) {
  const alerts = status?.rules.filter((r) => r.state !== "OK") ?? [];
  if (alerts.length === 0) return null;
  const breached = alerts.some((r) => r.state === "BREACHED");
  const Icon = breached
    ? AlertTriangle
    : alerts.every((r) => r.state === "HIT")
      ? CheckCircle2
      : ShieldCheck;
  return (
    <section
      role="status"
      aria-label="Today's risk limits"
      className={cn(
        "flex gap-3 rounded-[var(--radius-surface)] border px-4 py-3",
        breached ? "border-loss/50 bg-loss/10" : "border-coach/40 bg-coach/10",
      )}
    >
      <Icon
        className={cn("mt-0.5 h-5 w-5 shrink-0", breached ? "text-loss" : "text-coach")}
        aria-hidden="true"
      />
      <div className="grid gap-1 text-sm">
        {alerts.map((r) => (
          <p key={r.rule}>{r.message}</p>
        ))}
        <Link
          href="/goals"
          className="text-xs text-ink-muted underline underline-offset-4 hover:text-ink"
        >
          Your limits
        </Link>
      </div>
    </section>
  );
}
