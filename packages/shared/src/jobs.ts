/** Contract between the API (which enqueues) and the worker (which processes). */
export const SYNC_QUEUE = "exchange-sync";

export type SyncKind = "BACKFILL" | "INCREMENTAL" | "MANUAL";

export interface SyncJobData {
  accountId: string;
  kind: SyncKind;
}

/**
 * One job per account at a time: re-adding while a sync is queued or running is a no-op.
 * (BullMQ custom job IDs cannot contain ":".)
 */
export const syncJobId = (accountId: string): string => `sync-${accountId}`;

/** Queue options for sync jobs (plain object so the API does not need BullMQ types to share it). */
export const SYNC_JOB_OPTIONS = {
  attempts: 4,
  backoff: { type: "exponential", delay: 60_000 },
  // Finished jobs are removed so the per-account job ID can be reused; history lives in sync_runs.
  removeOnComplete: true,
  removeOnFail: true,
} as const;

export const MAINTENANCE_QUEUE = "maintenance";
/** Reminders, reports and coaching-note scheduling (every 15 minutes), separate from sync scheduling. */
export const ENGAGEMENT_QUEUE = "engagement";
