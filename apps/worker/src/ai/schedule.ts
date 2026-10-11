import { addDays, isValidTimeZone, localParts, startOfLocalDay } from "@atc/analytics";
import { planLimits, weekStart } from "@atc/coach";
import type { PrismaClient } from "@atc/db";
import { AI_JOB_OPTIONS, type AiJobData, aiJobId } from "@atc/shared";
import type { Queue } from "bullmq";

/** Only trades this recent are reviewed automatically; older ones on request (keeps backfills cheap). */
export const AUTO_REVIEW_WINDOW_MS = 48 * 3_600_000;

const add = (queue: Queue<AiJobData>, jobs: AiJobData[]) =>
  jobs.length
    ? queue.addBulk(
        jobs.map((data) => ({
          name: data.kind,
          data,
          opts: { ...AI_JOB_OPTIONS, jobId: aiJobId(data) },
        })),
      )
    : Promise.resolve([]);

/**
 * After a sync: queue market analysis (always) and AI reviews (when AI is on) for recently closed
 * trades that do not have them yet.
 */
export async function queueAutoReviews(
  db: PrismaClient,
  queue: Queue<AiJobData>,
  accountId: string,
  now = new Date(),
  opts: { reviews: boolean } = { reviews: true },
): Promise<number> {
  const recent = await db.position.findMany({
    where: {
      accountId,
      status: "CLOSED",
      closedAt: { gte: new Date(now.getTime() - AUTO_REVIEW_WINDOW_MS) },
      user: { deletedAt: null, suspendedAt: null },
    },
    select: { id: true, userId: true, sourceKey: true },
  });
  if (recent.length === 0) return 0;
  const where = { userId: recent[0]?.userId, positionKey: { in: recent.map((p) => p.sourceKey) } };
  const select = { positionKey: true } as const;
  const reviewed = new Set(
    (await db.tradeReview.findMany({ where, select })).map((r) => r.positionKey),
  );
  const analysed = new Set(
    (await db.tradeContext.findMany({ where, select })).map((r) => r.positionKey),
  );
  const jobs: AiJobData[] = [];
  for (const p of recent) {
    // A review computes the market context itself; analysis alone is queued only without one.
    if (opts.reviews && !reviewed.has(p.sourceKey)) {
      jobs.push({ kind: "REVIEW_TRADE", userId: p.userId, positionId: p.id });
    } else if (!analysed.has(p.sourceKey)) {
      jobs.push({ kind: "MARKET_CONTEXT", userId: p.userId, positionId: p.id });
    }
  }
  await add(queue, jobs);
  return jobs.length;
}

/**
 * Daily and weekly coaching notes, once each trader's own day (or week) has ended: yesterday's note
 * after local midnight, last week's on Monday. Idempotent: existing notes and queued jobs are skipped.
 */
export async function scheduleCoachNotes(
  db: PrismaClient,
  queue: Queue<AiJobData>,
  now = new Date(),
): Promise<number> {
  const active = await db.position.groupBy({
    by: ["userId"],
    where: { status: "CLOSED", closedAt: { gte: new Date(now.getTime() - 9 * 86_400_000) } },
  });
  if (active.length === 0) return 0;
  const users = await db.user.findMany({
    // Scheduled AI notes are for traders with a live exchange connection (not CSV-only accounts).
    where: {
      id: { in: active.map((a) => a.userId) },
      deletedAt: null,
      suspendedAt: null,
      exchangeAccounts: { some: { status: "ACTIVE" } },
    },
    select: { id: true, timezone: true },
  });
  const jobs: AiJobData[] = [];
  for (const u of users) {
    if ((await planLimits(db, u.id)).aiReviewsPerMonth === 0) continue;
    const tz = isValidTimeZone(u.timezone) ? u.timezone : "UTC";
    const today = localParts(now, tz).date;
    const yesterday = addDays(today, -1);
    const thisWeek = weekStart(today);
    const lastWeek = addDays(thisWeek, -7);
    const candidates: { kind: "DAILY" | "WEEKLY"; period: string; days: number }[] = [
      { kind: "DAILY", period: yesterday, days: 1 },
    ];
    // Weekly notes only on Monday and Tuesday: a note that cannot be written (plan limit, AI
    // refusal) is not retried for the rest of the week.
    if (today <= addDays(thisWeek, 1))
      candidates.push({ kind: "WEEKLY", period: lastWeek, days: 7 });
    for (const c of candidates) {
      const exists = await db.coachNote.findUnique({
        where: { userId_kind_period: { userId: u.id, kind: c.kind, period: c.period } },
        select: { id: true },
      });
      if (exists) continue;
      const traded = await db.position.findFirst({
        where: {
          userId: u.id,
          status: "CLOSED",
          closedAt: {
            gte: startOfLocalDay(c.period, tz),
            lt: startOfLocalDay(addDays(c.period, c.days), tz),
          },
        },
        select: { id: true },
      });
      if (!traded) continue;
      jobs.push(
        c.kind === "DAILY"
          ? { kind: "DAILY_NOTE", userId: u.id, date: c.period }
          : { kind: "WEEKLY_NOTE", userId: u.id, weekStart: c.period },
      );
    }
  }
  await add(queue, jobs);
  return jobs.length;
}
