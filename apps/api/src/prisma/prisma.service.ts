import { createPrismaClient, type PrismaClient } from "@atc/db";
import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(ENV) env: Env) {
    this.client = createPrismaClient(env.DATABASE_URL);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
