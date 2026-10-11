import { Module } from "@nestjs/common";
import { OpenPositionsController } from "./open-positions.controller.js";
import { OpenPositionsService } from "./open-positions.service.js";

@Module({ controllers: [OpenPositionsController], providers: [OpenPositionsService] })
export class OpenPositionsModule {}
