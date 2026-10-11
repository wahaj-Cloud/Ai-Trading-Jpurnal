import { type AnalyticsDto, type AnalyticsQuery, analyticsQuerySchema } from "@atc/shared";
import { Controller, Get, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../auth/decorators.js";
import type { AuthenticatedUser } from "../common/request.types.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { AnalyticsService } from "./analytics.service.js";

@Controller({ path: "analytics", version: "1" })
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
  ): Promise<AnalyticsDto> {
    return this.analytics.report(user.id, query);
  }
}
