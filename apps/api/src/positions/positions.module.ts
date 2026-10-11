import { Module } from "@nestjs/common";
import { JournalService } from "./journal.service.js";
import { PositionsController } from "./positions.controller.js";
import { PositionsService } from "./positions.service.js";

@Module({ controllers: [PositionsController], providers: [PositionsService, JournalService] })
export class PositionsModule {}
