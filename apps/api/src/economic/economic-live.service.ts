import { ECON_LIVE_CHANNEL, type EconomicLiveUpdate } from "@atc/shared";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Redis } from "ioredis";
import { Subject } from "rxjs";
import { ENV, type Env } from "../config/env.js";

/**
 * Relays released economic figures from the worker (Redis pub/sub) to every browser connected to
 * the live stream. One Redis subscription per API instance fans out to all its open connections.
 */
@Injectable()
export class EconomicLiveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EconomicLiveService.name);
  private sub: Redis | null = null;
  readonly updates$ = new Subject<EconomicLiveUpdate>();

  constructor(@Inject(ENV) private readonly env: Env) {}

  async onModuleInit(): Promise<void> {
    if (this.env.NODE_ENV === "test") return;
    this.sub = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null, family: 0 });
    this.sub.on("error", (err) => this.logger.warn(`live news subscriber: ${err.message}`));
    this.sub.on("message", (_channel, raw) => {
      try {
        const update = JSON.parse(raw) as EconomicLiveUpdate;
        if (update?.type === "release" && update.event?.id) this.updates$.next(update);
      } catch {
        // ignore malformed messages
      }
    });
    await this.sub.subscribe(ECON_LIVE_CHANNEL).catch((err: Error) => {
      this.logger.warn(`live news subscribe failed: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.updates$.complete();
    await this.sub?.quit().catch(() => undefined);
  }
}
