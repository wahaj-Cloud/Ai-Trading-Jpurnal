import type { WebhookEvent } from "@clerk/backend";
import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Logger,
  Post,
  type RawBodyRequest,
  Req,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Webhook } from "svix";
import { Public } from "../auth/decorators.js";
import type { AppRequest } from "../common/request.types.js";
import { ENV, type Env } from "../config/env.js";
import { profileFromClerkJson } from "../users/provider-profile.js";
import { UsersService } from "../users/users.service.js";

/** Keeps our users table in sync with Clerk. Authenticity is proven by the Svix signature. */
@Controller({ path: "webhooks/clerk", version: "1" })
export class ClerkWebhookController {
  private readonly logger = new Logger(ClerkWebhookController.name);
  private readonly verifier: Webhook;

  constructor(
    private readonly users: UsersService,
    @Inject(ENV) env: Env,
  ) {
    this.verifier = new Webhook(env.CLERK_WEBHOOK_SIGNING_SECRET);
  }

  @Public()
  @SkipThrottle()
  @Post()
  @HttpCode(204)
  async handle(@Req() req: RawBodyRequest<AppRequest>): Promise<void> {
    const event = this.verify(req);

    switch (event.type) {
      case "user.created":
      case "user.updated": {
        const profile = profileFromClerkJson(event.data);
        if (!profile) {
          this.logger.warn({ msg: "clerk user without primary email", clerkUserId: event.data.id });
          return;
        }
        await this.users.upsertFromProvider(profile, "webhook");
        return;
      }
      case "user.deleted":
        if (event.data.id) await this.users.softDeleteByAuthProviderId(event.data.id);
        return;
      default:
        return; // Acknowledge unhandled event types so Clerk does not retry them.
    }
  }

  private verify(req: RawBodyRequest<AppRequest>): WebhookEvent {
    if (!req.rawBody) throw new BadRequestException("Missing body");
    const payload = req.rawBody.toString("utf8");
    try {
      // Throws on bad signature or a timestamp outside the replay window.
      this.verifier.verify(payload, {
        "svix-id": req.get("svix-id") ?? "",
        "svix-timestamp": req.get("svix-timestamp") ?? "",
        "svix-signature": req.get("svix-signature") ?? "",
      });
    } catch {
      throw new BadRequestException("Invalid webhook signature");
    }
    return JSON.parse(payload) as WebhookEvent;
  }
}
