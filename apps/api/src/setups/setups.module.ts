import { Module } from "@nestjs/common";
import { SetupAlertsController, SetupsController } from "./setups.controller.js";
import { SetupsService } from "./setups.service.js";

@Module({ controllers: [SetupsController, SetupAlertsController], providers: [SetupsService] })
export class SetupsModule {}
