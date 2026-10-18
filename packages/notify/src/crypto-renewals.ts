import type { PrismaClient } from "@atc/db";
import { type NotifyDeps, notify } from "./service.js";

const DAY = 86_400_000;
const PLAN_NAME: Record<string, string> = { PRO: "Pro", PREMIUM: "Premium" };

/**
 * Crypto-prepaid plans do not renew by themselves. Every scheduler tick: remind 7 days and 1 day
 * before the end, and move plans whose paid time is over back to Free (with a notice). Plans billed
 * by card or granted by support are never touched.
 */
export async function runCryptoRenewals(
  deps: NotifyDeps,
): Promise<{ reminded: number; ended: number }> {
  const db: PrismaClient = deps.db;
  const now = deps.now?.() ?? new Date();
  const base = {
    paddleSubscriptionId: null,
    manualPlan: false,
    planCode: { not: "FREE" as const },
    user: { deletedAt: null },
  };
  let reminded = 0;
  const soon = await db.subscription.findMany({
    where: { ...base, cryptoPaidUntil: { gt: now, lte: new Date(now.getTime() + 7 * DAY) } },
    select: { userId: true, planCode: true, cryptoPaidUntil: true },
  });
  for (const s of soon) {
    const until = s.cryptoPaidUntil as Date;
    const left = until.getTime() - now.getTime();
    const stage = left <= DAY ? 1 : 7;
    const date = until.toISOString().slice(0, 10);
    const n = await notify(deps, {
      userId: s.userId,
      kind: "ACCOUNT",
      title: `Your ${PLAN_NAME[s.planCode] ?? s.planCode} plan ends ${stage === 1 ? "tomorrow" : "in a week"}`,
      body: `You paid with crypto, which does not renew by itself. Your plan runs until ${until.toUTCString().slice(0, 16)}. Renew from Billing to keep your limits, history and AI coach; any time left is added on.`,
      link: "/billing",
      dedupeKey: `crypto-renew:${date}:${stage}`,
    });
    if (n) reminded++;
  }

  const ended = await db.subscription.findMany({
    where: { ...base, cryptoPaidUntil: { lte: now } },
    select: { userId: true, planCode: true, cryptoPaidUntil: true },
  });
  for (const s of ended) {
    // Conditional update: a renewal paid at this very moment wins.
    const moved = await db.subscription.updateMany({
      where: {
        userId: s.userId,
        cryptoPaidUntil: s.cryptoPaidUntil,
        paddleSubscriptionId: null,
        manualPlan: false,
      },
      data: {
        planCode: "FREE",
        status: "ACTIVE",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
    });
    if (moved.count === 0) continue;
    await db.auditLog.create({
      data: {
        actorId: null,
        action: "billing.crypto_expired",
        entity: "subscription",
        entityId: s.userId,
        metadata: { plan: s.planCode, until: (s.cryptoPaidUntil as Date).toISOString() },
      },
    });
    await notify(deps, {
      userId: s.userId,
      kind: "ACCOUNT",
      title: `Your ${PLAN_NAME[s.planCode] ?? s.planCode} plan has ended`,
      body: "Your crypto-paid period is over and your account is on the Free plan. Your trades and journal are safe; renew from Billing any time to unlock everything again.",
      link: "/billing",
      dedupeKey: `crypto-ended:${(s.cryptoPaidUntil as Date).toISOString()}`,
    });
  }
  return { reminded, ended: ended.length };
}
