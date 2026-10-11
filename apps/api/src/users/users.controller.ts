import { type MeResponse, type UpdateProfileInput, updateProfileSchema } from "@atc/shared";
import { Body, Controller, Get, Patch, Req } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators.js";
import { type AppRequest, type AuthenticatedUser, requestMeta } from "../common/request.types.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { UsersService } from "./users.service.js";

@Controller({ path: "me", version: "1" })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  getMe(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    return this.users.getMe(user.id);
  }

  @Patch()
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
    @Req() req: AppRequest,
  ): Promise<MeResponse> {
    return this.users.updateProfile(user.id, body, requestMeta(req));
  }
}
