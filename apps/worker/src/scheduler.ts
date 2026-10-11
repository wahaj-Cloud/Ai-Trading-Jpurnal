import type { PrismaClient } from "@atc/db";
import { SYNC_JOB_OPTIONS, type SyncJobData, syncJobId } from "@atc/shared";
import type { Queue } from "bullmq";

const BATCH = 500;

/**
 * Queues a sync for every active account that is due. Accounts that never finished their first
 * download get a BACKFILL. Adding a job for an account that already has one queued or running is
 * a no-op (same job ID), so overlapping ticks are harmless.
 */
export async function scheduleDueSyncs(
  db: PrismaClient,
  queue: Queue<SyncJobData>,
  intervalMinutes: number,
  now: number = Date.now(),
): Promise<number> {
  const dueBefore = new Date(now - intervalMinutes * 60_000);
  const accounts = await db.exchangeAccount.findMany({
    where: {
      // CONNECTING: MetaTrader accounts still logging in are checked every minute.
      status: { in: ["ACTIVE", "CONNECTING"] },
      credential: { isNot: null },
      // Deleted and suspended users are never synced.
      user: { deletedAt: null, suspendedAt: null },
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: dueBefore } }],
      // Accounts in failure backoff wait until their retry time.
      AND: [{ OR: [{ syncRetryAt: null }, { syncRetryAt: { lte: new Date(now) } }] }],
    },
    select: { id: true, backfillCompletedAt: true },
    orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
    take: BATCH,
  });
  await queue.addBulk(
    accounts.map((a) => ({
      name: "sync",
      data: { accountId: a.id, kind: a.backfillCompletedAt ? "INCREMENTAL" : "BACKFILL" },
      opts: { ...SYNC_JOB_OPTIONS, jobId: syncJobId(a.id) },
    })),
  );
  return accounts.length;
}
