import {
  type AdminAuditRowDto,
  type AdminCostsDto,
  type AdminLogsPage,
  type AdminOverviewDto,
  type AdminPaymentsDto,
  type AdminPlanChange,
  type AdminPlanUpdate,
  type AdminSyncRowDto,
  type AdminUserDetailDto,
  type AdminUsersPage,
  type AnnouncementDto,
  type AnnouncementInput,
  adminFoundingSchema,
  adminPlanChangeSchema,
  adminPlanUpdateSchema,
  adminSuspendSchema,
  announcementInputSchema,
  type ScalpCalibrationDto,
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
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../auth/decorators.js";
import type { AuthenticatedUser } from "../common/request.types.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { AdminGuard } from "./admin.guard.js";
import { AdminService } from "./admin.service.js";

const usersQuery = z
  .object({ q: z.string().trim().max(100).optional(), cursor: z.uuid().optional() })
  .strict();
const auditQuery = z
  .object({ action: z.string().trim().max(60).optional(), cursor: z.uuid().optional() })
  .strict();
const costsQuery = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
  })
  .strict();
const planCode = z.enum(["FREE", "PRO", "PREMIUM", "ENTERPRISE"]);
const syncQuery = z
  .object({ failed: z.enum(["true", "false"]).optional(), cursor: z.uuid().optional() })
  .strict();

const paymentsQuery = z
  .object({ problems: z.enum(["true", "false"]).optional(), cursor: z.uuid().optional() })
  .strict();

const calibrationQuery = z
  .object({ days: z.coerce.number().int().min(1).max(8).default(7) })
  .strict();

@Controller({ path: "admin", version: "1" })
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("overview")
  overview(): Promise<AdminOverviewDto> {
    return this.admin.overview();
  }

  /** Threshold review of the Scalp Cockpit strength labels, from the recorded minutes. */
  @Get("scalp-calibration")
  scalpCalibration(
    @Query(new ZodValidationPipe(calibrationQuery)) q: z.infer<typeof calibrationQuery>,
  ): Promise<ScalpCalibrationDto> {
    return this.admin.scalpCalibration(q.days);
  }

  @Get("costs")
  costs(
    @Query(new ZodValidationPipe(costsQuery)) q: z.infer<typeof costsQuery>,
  ): Promise<AdminCostsDto> {
    return this.admin.costs(q.month ?? new Date().toISOString().slice(0, 7));
  }

  @Put("plans/:code")
  @HttpCode(204)
  async updatePlan(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("code", new ZodValidationPipe(planCode)) code: z.infer<typeof planCode>,
    @Body(new ZodValidationPipe(adminPlanUpdateSchema)) body: AdminPlanUpdate,
  ): Promise<void> {
    await this.admin.updatePlan(actor.id, code, body);
  }

  @Put("users/:id/founding")
  founding(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(adminFoundingSchema)) body: z.infer<typeof adminFoundingSchema>,
  ): Promise<AdminUserDetailDto> {
    return this.admin.setFoundingMember(actor.id, id, body.foundingMember);
  }

  @Get("users")
  users(
    @Query(new ZodValidationPipe(usersQuery)) q: z.infer<typeof usersQuery>,
  ): Promise<AdminUsersPage> {
    return this.admin.users(q.q || undefined, q.cursor);
  }

  @Get("users/:id")
  user(@Param("id", new ParseUUIDPipe()) id: string): Promise<AdminUserDetailDto> {
    return this.admin.user(id);
  }

  @Put("users/:id/plan")
  plan(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(adminPlanChangeSchema)) body: AdminPlanChange,
  ): Promise<AdminUserDetailDto> {
    return this.admin.changePlan(actor.id, id, body);
  }

  @Put("users/:id/suspension")
  suspend(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(adminSuspendSchema)) body: z.infer<typeof adminSuspendSchema>,
  ): Promise<AdminUserDetailDto> {
    return this.admin.setSuspended(actor.id, id, body.suspended, body.reason);
  }

  @Get("logs/audit")
  audit(
    @Query(new ZodValidationPipe(auditQuery)) q: z.infer<typeof auditQuery>,
  ): Promise<AdminLogsPage<AdminAuditRowDto>> {
    return this.admin.auditLog(q.action || undefined, q.cursor);
  }

  @Get("payments")
  payments(
    @Query(new ZodValidationPipe(paymentsQuery)) q: z.infer<typeof paymentsQuery>,
  ): Promise<AdminPaymentsDto> {
    return this.admin.payments(q.problems === "true", q.cursor);
  }

  @Get("logs/sync")
  sync(
    @Query(new ZodValidationPipe(syncQuery)) q: z.infer<typeof syncQuery>,
  ): Promise<AdminLogsPage<AdminSyncRowDto>> {
    return this.admin.syncRuns(q.failed === "true", q.cursor);
  }

  @Get("announcements")
  announcements(): Promise<AnnouncementDto[]> {
    return this.admin.announcements();
  }

  @Post("announcements")
  @HttpCode(200)
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(announcementInputSchema)) body: AnnouncementInput,
  ): Promise<AnnouncementDto> {
    return this.admin.createAnnouncement(actor.id, body);
  }

  @Delete("announcements/:id")
  @HttpCode(204)
  async end(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.admin.endAnnouncement(actor.id, id);
  }
}

/** Announcements for every signed-in user (no admin rights needed). */
@Controller({ path: "announcements", version: "1" })
export class AnnouncementsController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  active(): Promise<AnnouncementDto[]> {
    return this.admin.activeAnnouncements();
  }
}
