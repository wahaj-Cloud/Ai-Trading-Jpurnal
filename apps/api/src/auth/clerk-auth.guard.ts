import { verifyToken } from "@clerk/backend";
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AppRequest } from "../common/request.types.js";
import { ENV, type Env } from "../config/env.js";
import { UsersService } from "../users/users.service.js";
import { IS_PUBLIC } from "./decorators.js";

/**
 * Global guard: verifies the Clerk session JWT (signature, expiry, issuing origin),
 * then resolves our internal user, provisioning it on first sight.
 */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const token = extractBearer(req.get("authorization"));
    if (!token) throw new UnauthorizedException("Missing bearer token");

    let clerkUserId: string;
    try {
      const payload = await verifyToken(token, {
        secretKey: this.env.CLERK_SECRET_KEY,
        authorizedParties: this.env.WEB_ORIGINS,
      });
      clerkUserId = payload.sub;
    } catch {
      throw new UnauthorizedException("Invalid or expired session");
    }

    const user = await this.users.resolveByAuthProviderId(clerkUserId);
    if (!user) throw new ForbiddenException("Account is disabled");
    req.user = user;
    return true;
  }
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : null;
}
