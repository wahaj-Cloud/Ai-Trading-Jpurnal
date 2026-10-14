import {
  type SetupAlertsPage,
  type SetupAlertsQuery,
  type SetupDto,
  type SetupInput,
  type SetupPatch,
  type SetupPreviewDto,
  type SetupPreviewInput,
  type SetupsListDto,
  setupAlertsQuerySchema,
  setupInputSchema,
  setupPatchSchema,
  setupPreviewSchema,
} from "@atc/shared";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../auth/decorators.js";
import type { AuthenticatedUser } from "../common/request.types.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { SetupsService } from "./setups.service.js";

@Controller({ path: "setups", version: "1" })
export class SetupsController {
  constructor(private readonly setups: SetupsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<SetupsListDto> {
    return this.setups.list(user.id);
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(setupInputSchema)) input: SetupInput,
  ): Promise<SetupDto> {
    return this.setups.create(user.id, input);
  }

  /** Declared before ":id" so "preview" is never read as an id. */
  @Post("preview")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  preview(
    @Body(new ZodValidationPipe(setupPreviewSchema)) input: SetupPreviewInput,
  ): Promise<SetupPreviewDto> {
    return this.setups.preview(input);
  }

  @Get(":id")
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<SetupDto> {
    return this.setups.get(user.id, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(setupPatchSchema)) patch: SetupPatch,
  ): Promise<SetupDto> {
    return this.setups.update(user.id, id, patch);
  }

  @Post(":id/pause")
  @HttpCode(200)
  pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<SetupDto> {
    return this.setups.setActive(user.id, id, false);
  }

  @Post(":id/resume")
  @HttpCode(200)
  resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<SetupDto> {
    return this.setups.setActive(user.id, id, true);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.setups.remove(user.id, id);
  }
}

@Controller({ path: "setup-alerts", version: "1" })
export class SetupAlertsController {
  constructor(private readonly setups: SetupsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(setupAlertsQuerySchema)) q: SetupAlertsQuery,
  ): Promise<SetupAlertsPage> {
    return this.setups.alerts(user.id, q);
  }

  @Patch(":id")
  @HttpCode(204)
  dismiss(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.setups.dismiss(user.id, id);
  }
}
