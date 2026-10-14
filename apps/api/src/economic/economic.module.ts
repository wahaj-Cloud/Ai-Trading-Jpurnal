import { Module } from "@nestjs/common";
import { EconomicController } from "./economic.controller.js";
import { EconomicService } from "./economic.service.js";
import { EconomicLiveService } from "./economic-live.service.js";

@Module({ controllers: [EconomicController], providers: [EconomicService, EconomicLiveService] })
export class EconomicModule {}
