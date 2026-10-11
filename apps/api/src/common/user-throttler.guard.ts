import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { AppRequest } from "./request.types.js";

/**
 * Rate limits per signed-in user. Browser traffic reaches the API through the web server, so a
 * per-IP key would put every user in one bucket. Runs after authentication; the few public routes
 * (webhooks, health) skip throttling, and anything else unauthenticated falls back to the IP.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as unknown as AppRequest;
    return r.user ? `user:${r.user.id}` : `ip:${r.ip ?? "unknown"}`;
  }
}
