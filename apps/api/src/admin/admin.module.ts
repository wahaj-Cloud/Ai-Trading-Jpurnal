import { Module } from "@nestjs/common";
import { AdminController, AnnouncementsController } from "./admin.controller.js";
import { AdminGuard } from "./admin.guard.js";
import { AdminService } from "./admin.service.js";

@Module({
  controllers: [AdminController, AnnouncementsController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
