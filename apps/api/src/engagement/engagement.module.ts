import { Module } from "@nestjs/common";
import { EngagementController } from "./engagement.controller.js";
import { EngagementService } from "./engagement.service.js";

@Module({ controllers: [EngagementController], providers: [EngagementService] })
export class EngagementModule {}
