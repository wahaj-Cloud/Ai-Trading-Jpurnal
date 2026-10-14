import { type BillingDto, changePlanSchema, type PublicPlanDto } from "@atc/shared";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  type RawBodyRequest,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { CurrentUser, Public } from "../auth/decorators.js";
import type { AppRequest, AuthenticatedUser } from "../common/request.types.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ENV, type Env } from "../config/env.js";
import { BillingService } from "./billing.service.js";
import { type PaddleEvent, verifyPaddleSignature } from "./paddle.js";

@Controller({ version: "1" })
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    private readonly billing: BillingService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Plan names, list prices and limits for the public pricing section. */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get("public/plans")
  plans(): Promise<PublicPlanDto[]> {
    return this.billing.publicPlans();
  }

  @Get("billing")
  get(@CurrentUser() user: AuthenticatedUser): Promise<BillingDto> {
    return this.billing.billing(user.id);
  }

  @Post("billing/portal")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  portal(@CurrentUser() user: AuthenticatedUser): Promise<{ url: string }> {
    return this.billing.portal(user.id);
  }

  @Post("billing/change-plan")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  changePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(changePlanSchema)) body: { priceId: string },
  ): Promise<{ ok: true }> {
    return this.billing.changePlan(user.id, body.priceId);
  }

  /** Paddle notifications. Authenticity is proven by the HMAC signature, not by a session. */
  @Public()
  @SkipThrottle()
  @Post("webhooks/paddle")
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<AppRequest>): Promise<{ ok: true; outcome: string }> {
    const secret = this.env.PADDLE_WEBHOOK_SECRET;
    if (!secret) throw new UnauthorizedException("Billing webhooks are not configured");
    if (!req.rawBody) throw new BadRequestException("Missing body");
    if (!verifyPaddleSignature(req.rawBody, req.get("paddle-signature"), secret)) {
      throw new UnauthorizedException("Invalid signature");
    }
    let event: PaddleEvent;
    try {
      event = JSON.parse(req.rawBody.toString("utf8")) as PaddleEvent;
    } catch {
      throw new BadRequestException("Invalid JSON");
    }
    if (!event.event_id || !event.event_type || !event.occurred_at)
      throw new BadRequestException("Not a Paddle event");
    const outcome = await this.billing.handleEvent(event);
    this.logger.log({ msg: "paddle event", type: event.event_type, outcome });
    return { ok: true, outcome };
  }
}
