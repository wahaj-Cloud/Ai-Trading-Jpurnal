import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { AppRequest } from "../common/request.types.js";

/** Admin routes: runs after the global authentication guard, so the user is already verified. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest<AppRequest>().user;
    if (user?.role !== "ADMIN") throw new ForbiddenException("Admins only");
    return true;
  }
}
