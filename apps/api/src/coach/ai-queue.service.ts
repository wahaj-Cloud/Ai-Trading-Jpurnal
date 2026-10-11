import { AI_JOB_OPTIONS, AI_QUEUE, type AiJobData, aiJobId } from "@atc/shared";
import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { ENV, type Env } from "../config/env.js";

/** Producer side of the AI queue; the worker writes reviews and notes. */
@Injectable()
export class AiQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(AiQueueService.name);
  private readonly queue: Queue<AiJobData>;

  constructor(@Inject(ENV) env: Env) {
    this.queue = new Queue<AiJobData>(AI_QUEUE, {
      connection: { url: env.REDIS_URL, maxRetriesPerRequest: null, family: 0 },
    });
  }

  /**
   * A forced refresh gets its own ID so a recent job for the same trade does not swallow it. Market
   * analysis is keyed by the hour: repeated clicks on one trade queue one job, not one per click.
   */
  async enqueue(data: AiJobData, unique = false): Promise<boolean> {
    try {
      const suffix =
        data.kind === "MARKET_CONTEXT" ? new Date().toISOString().slice(0, 13) : String(Date.now());
      const jobId = unique ? `${aiJobId(data)}-${suffix}` : aiJobId(data);
      await this.queue.add(data.kind, data, { ...AI_JOB_OPTIONS, jobId });
      return true;
    } catch (err) {
      this.logger.warn({ msg: "could not queue AI job", kind: data.kind, err });
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
