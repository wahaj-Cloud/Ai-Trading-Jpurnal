import { Module } from "@nestjs/common";
import { EconomicController } from "./economic.controller.js";
import { EconomicService } from "./economic.service.js";

@Module({ controllers: [EconomicController], providers: [EconomicService] })
export class EconomicModule {}
