import {
  type GoalDto,
  type GoalInput,
  goalInputSchema,
  type NotificationPrefs,
  type NotificationsPage,
  notificationPrefsSchema,
  type RiskLimits,
  type RiskStatusDto,
  riskLimitsSchema,
} from "@atc/shared";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../auth/decorators.js";
import type { AuthenticatedUser } from "../common/request.types.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { EngagementService } from "./engagement.service.js";

const pageQuery = z.object({ cursor: z.uuid().optional() }).strict();
const readBody = z
  .object({ ids: z.union([z.literal("all"), z.array(z.uuid()).min(1).max(100)]) })
  .strict();

@Controller({ version: "1" })
export class EngagementController {
  constructor(private readonly svc: EngagementService) {}

  @Get("risk-limits")
  riskLimits(@CurrentUser() user: AuthenticatedUser): Promise<RiskLimits> {
    return this.svc.riskLimits(user.id);
  }

  @Put("risk-limits")
  saveRiskLimits(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(riskLimitsSchema)) body: RiskLimits,
  ): Promise<RiskLimits> {
    return this.svc.saveRiskLimits(user.id, body);
  }

  @Get("risk-status")
  riskStatus(@CurrentUser() user: AuthenticatedUser): Promise<RiskStatusDto> {
    return this.svc.riskStatus(user.id);
  }

  @Get("goals")
  goals(@CurrentUser() user: AuthenticatedUser): Promise<GoalDto[]> {
    return this.svc.goals(user.id);
  }

  @Post("goals")
  @HttpCode(200)
  createGoal(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(goalInputSchema)) body: GoalInput,
  ): Promise<GoalDto[]> {
    return this.svc.createGoal(user.id, body);
  }

  @Delete("goals/:id")
  @HttpCode(204)
  async deleteGoal(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.svc.deleteGoal(user.id, id);
  }

  @Get("notifications")
  notifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(pageQuery)) q: z.infer<typeof pageQuery>,
  ): Promise<NotificationsPage> {
    return this.svc.notifications(user.id, q.cursor);
  }

  @Get("notifications/unread-count")
  async unread(@CurrentUser() user: AuthenticatedUser): Promise<{ unread: number }> {
    return { unread: await this.svc.unreadCount(user.id) };
  }

  @Post("notifications/read")
  @HttpCode(204)
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(readBody)) body: z.infer<typeof readBody>,
  ): Promise<void> {
    await this.svc.markRead(user.id, body.ids);
  }

  @Get("notification-preferences")
  prefs(@CurrentUser() user: AuthenticatedUser): Promise<NotificationPrefs> {
    return this.svc.prefs(user.id);
  }

  @Put("notification-preferences")
  savePrefs(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(notificationPrefsSchema)) body: NotificationPrefs,
  ): Promise<NotificationPrefs> {
    return this.svc.savePrefs(user.id, body);
  }
}
