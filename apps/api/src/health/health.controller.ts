import { Controller, Get, ServiceUnavailableException, VERSION_NEUTRAL } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "../auth/decorators.js";
import { PrismaService } from "../prisma/prisma.service.js";

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
}
