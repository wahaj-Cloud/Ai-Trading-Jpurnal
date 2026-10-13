import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { AdminModule } from "./admin/admin.module.js";
import { AnalyticsModule } from "./analytics/analytics.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { ClerkAuthGuard } from "./auth/clerk-auth.guard.js";
import { BillingModule } from "./billing/billing.module.js";
import { ClerkModule } from "./clerk/clerk.module.js";
import { CoachModule } from "./coach/coach.module.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";
import { RedisThrottlerStorage } from "./common/redis-throttler.storage.js";
import { UserThrottlerGuard } from "./common/user-throttler.guard.js";
import { ConfigModule } from "./config/config.module.js";
import { ENV, type Env } from "./config/env.js";
import { EconomicModule } from "./economic/economic.module.js";
import { EngagementModule } from "./engagement/engagement.module.js";
import { ExchangeAccountsModule } from "./exchange-accounts/exchange-accounts.module.js";
import { FxModule } from "./fx/fx.module.js";
import { HealthController } from "./health/health.controller.js";
import { OpenPositionsModule } from "./open-positions/open-positions.module.js";
import { PositionsModule } from "./positions/positions.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { ReportsModule } from "./reports/reports.module.js";
import { SyncModule } from "./sync/sync.module.js";
import { UsersModule } from "./users/users.module.js";
import { WebhooksModule } from "./webhooks/webhooks.module.js";

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ClerkModule,
    AuditModule,
    SyncModule,
    // Per-user limits, counted in Redis so they hold across every API instance.
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        throttlers: [{ name: "default", ttl: 60_000, limit: 120 }],
        storage: env.NODE_ENV === "test" ? undefined : new RedisThrottlerStorage(env.REDIS_URL),
      }),
    }),
    UsersModule,
    WebhooksModule,
    ExchangeAccountsModule,
    PositionsModule,
    OpenPositionsModule,
    AnalyticsModule,
    CoachModule,
    EngagementModule,
    ReportsModule,
    BillingModule,
    AdminModule,
    FxModule,
    EconomicModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: authenticate first, then rate-limit by user.
    { provide: APP_GUARD, useClass: ClerkAuthGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
