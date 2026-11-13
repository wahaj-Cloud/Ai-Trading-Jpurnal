import { Module } from "@nestjs/common";
import { ExportService } from "./export.service.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

@Module({
  controllers: [UsersController],
  providers: [UsersService, ExportService],
  exports: [UsersService],
})
export class UsersModule {}
