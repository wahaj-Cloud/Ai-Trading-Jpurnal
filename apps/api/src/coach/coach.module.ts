import { Global, Module } from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";
import { AiQueueService } from "./ai-queue.service.js";
import { CoachController } from "./coach.controller.js";
import { CoachService } from "./coach.service.js";
import { COACH_MODEL, createCoachModel } from "./coach-model.js";

@Global()
@Module({
  controllers: [CoachController],
  providers: [
    { provide: COACH_MODEL, inject: [ENV], useFactory: (env: Env) => createCoachModel(env) },
    AiQueueService,
    CoachService,
  ],
  exports: [CoachService],
})
export class CoachModule {}
