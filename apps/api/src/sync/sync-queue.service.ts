import {
  SYNC_JOB_OPTIONS,
  SYNC_QUEUE,
  type SyncJobData,
  type SyncKind,
  syncJobId,
} from "@atc/shared";
import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { ENV, type Env } from "../config/env.js";

/** Producer side of the sync queue. The worker service processes the jobs. */
@Injectable()
export class SyncQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(SyncQueueService.name);
  private readonly queue: Queue<SyncJobData>;

  constructor(@Inject(ENV) env: Env) {
    this.queue = new Queue<SyncJobData>(SYNC_QUEUE, {
      connection: { url: env.REDIS_URL, maxRetriesPerRequest: null, family: 0 },
    });
  }

  /**
   * Queues a sync unless one is already queued or running for the account (same job ID).
   * Never throws: if Redis is unreachable, the worker's scheduler still picks the account up.
   */
  async enqueue(accountId: string, kind: SyncKind): Promise<boolean> {
    try {
      await this.queue.add(
        "sync",
        { accountId, kind },
        { ...SYNC_JOB_OPTIONS, jobId: syncJobId(accountId) },
      );
      return true;
    } catch (err) {
      this.logger.warn({ msg: "could not queue sync; scheduler will retry", accountId, err });
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
