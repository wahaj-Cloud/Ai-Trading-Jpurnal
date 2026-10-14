import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module.js";
import { BacktestsService } from "./backtests.service.js";
import { BacktestsController, WhatIfController } from "./labs.controller.js";
import { WhatIfService } from "./what-if.service.js";

/** What-If Lab (Pro) and Strategy Lab (Premium). */
@Module({
  imports: [AnalyticsModule],
  controllers: [WhatIfController, BacktestsController],
  providers: [WhatIfService, BacktestsService],
})
export class LabsModule {}
