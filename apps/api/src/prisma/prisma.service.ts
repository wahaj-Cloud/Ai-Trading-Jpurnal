import {
  createPrismaClient,
  type PrismaClient,
  redisSnapshotMirror,
  setSnapshotMirror,
} from "@atc/db";
import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { ENV, type Env } from "../config/env.js";

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;
  /** Market snapshots are read from Redis first (written there by the worker): no database transfer. */
  private readonly mirror: Redis | null = null;

  constructor(@Inject(ENV) env: Env) {
    this.client = createPrismaClient(env.DATABASE_URL);
    if (env.NODE_ENV !== "test" && env.REDIS_URL) {
      this.mirror = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        family: 0,
        lazyConnect: false,
      });
      this.mirror.on("error", () => undefined);
      setSnapshotMirror(redisSnapshotMirror(this.mirror));
    }
  }

  async onModuleDestroy(): Promise<void> {
    setSnapshotMirror(null);
    await this.mirror?.quit().catch(() => undefined);
    await this.client.$disconnect();
  }
}
