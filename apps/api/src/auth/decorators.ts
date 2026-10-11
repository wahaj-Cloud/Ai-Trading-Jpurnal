import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { AppRequest, AuthenticatedUser } from "../common/request.types.js";

export const IS_PUBLIC = "isPublic";
/** Opt a route out of authentication. Every route is private by default. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const user = ctx.switchToHttp().getRequest<AppRequest>().user;
    if (!user) throw new Error("CurrentUser used on a route without authentication");
    return user;
  },
);
