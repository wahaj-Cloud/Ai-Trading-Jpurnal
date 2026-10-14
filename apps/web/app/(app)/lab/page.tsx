import type { RiskLimits, WhatIfScenarioDto, WhatIfTeaserDto } from "@atc/shared";
import { Lock } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { convertTeaser } from "@/features/currency/convert";
import { WhatIfLab } from "@/features/labs/what-if-lab";
import { formatMoney } from "@/features/trades/format";
import { apiFetch } from "@/lib/api";
import { getDisplay } from "@/lib/display";
import { getMe } from "@/lib/me";

export const metadata = { title: "What-If Lab" };

/** What-If Lab: Pro and above. Free plans see one fixed scenario on their own trades. */
export default async function WhatIfPage() {
  const me = await getMe();
  if (me.plan.limits.whatIf !== 1) {
    const [teaser, display] = await Promise.all([
      apiFetch<WhatIfTeaserDto>("/v1/what-if/teaser"),
      getDisplay(),
    ]);
    const t = convertTeaser(teaser, display);
    const diff = t.difference === null ? null : Number(t.difference);
    return (
      <section className="surface grid max-w-3xl gap-4 rounded-[var(--radius-surface)] p-6">
        <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-coach uppercase">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Pro feature · preview
        </p>
        {diff === null ? (
          <p className="text-lg font-semibold">
            Once you have 10 closed trades, this shows what your own rules would have changed.
          </p>
        ) : diff === 0 ? (
          <p className="text-lg font-semibold">
            Over the last 90 days you never kept trading after 2 losses in a row. Good discipline:
            try other rules with Pro.
          </p>
        ) : (
          <p className="text-lg font-semibold">
            Over the last 90 days, stopping after 2 losses in a row would have{" "}
            <span className={diff >= 0 ? "text-profit" : "text-loss"}>
              {diff >= 0 ? "added" : "cost you"} {formatMoney(String(Math.abs(diff)), display.code)}
            </span>
            {t.drawdownBefore &&
            t.drawdownAfter &&
            Number(t.drawdownAfter) < Number(t.drawdownBefore)
              ? `, and your largest drawdown would have been ${formatMoney(t.drawdownAfter, display.code)} instead of ${formatMoney(t.drawdownBefore, display.code)}`
              : ""}
            .
          </p>
        )}
        <p className="text-sm text-ink-muted">
          With Pro you can replay your real trades with any rule: a daily loss limit, a trade cap,
          skipping FOMO or revenge trades, only your best session, a risk cap. Nothing is invented:
          the lab only removes or scales trades you actually took.
        </p>
        <ButtonLink href="/billing" className="justify-self-start">
          Upgrade to Pro
        </ButtonLink>
      </section>
    );
  }
  const [scenarios, limits] = await Promise.all([
    apiFetch<WhatIfScenarioDto[]>("/v1/what-if/scenarios"),
    apiFetch<RiskLimits>("/v1/risk-limits").catch(() => null),
  ]);
  return (
    <WhatIfLab
      scenarios={scenarios}
      goalDailyLoss={limits?.maxDailyLoss ?? null}
      goalMaxTrades={limits?.maxTradesPerDay ?? null}
    />
  );
}
