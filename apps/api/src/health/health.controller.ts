import { DB_HEALTH_KEY, type DbHealth } from "@atc/db";
import type { ServiceStatusDto } from "@atc/shared";
import { Controller, Get, ServiceUnavailableException, VERSION_NEUTRAL } from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { Public } from "../auth/decorators.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** Reads the worker's last database check from Redis (works while the database refuses us). */
export async function readDbHealth(prisma: PrismaService): Promise<DbHealth | null> {
  const raw = await prisma.redis?.get(DB_HEALTH_KEY).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DbHealth;
  } catch {
    return null;
  }
}

@Controller({ path: "health", version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Used by the hosting platform to decide whether this instance can receive traffic. */
  @Public()
  @SkipThrottle()
  @Get()
  async check(): Promise<{ status: "ok" }> {
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch {
      throw new ServiceUnavailableException("Database unavailable");
    }
  }

  /**
   * Public service status for the app's error page: whether trading data can be loaded right now.
   * Says nothing about why (no plan or provider details), only whether and since when.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get("status")
  async status(): Promise<ServiceStatusDto> {
    const ok = await this.prisma.client.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    const worker = await readDbHealth(this.prisma);
    return {
      database: ok ? "ok" : "down",
      since: ok ? null : worker && !worker.ok ? worker.since : null,
      checkedAt: new Date().toISOString(),
    };
  }
}
