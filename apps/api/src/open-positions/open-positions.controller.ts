import type { OpenPositionsDto } from "@atc/shared";
import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators.js";
import type { AuthenticatedUser } from "../common/request.types.js";
import { OpenPositionsService } from "./open-positions.service.js";

@Controller({ path: "open-positions", version: "1" })
export class OpenPositionsController {
  constructor(private readonly openPositions: OpenPositionsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<OpenPositionsDto> {
    return this.openPositions.list(user.id);
  }
}
