import {
  type ConnectExchangeInput,
  connectExchangeSchema,
  type ExchangeAccountDto,
  type ExchangeAccountsResponse,
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
  Req,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../auth/decorators.js";
import { type AppRequest, type AuthenticatedUser, requestMeta } from "../common/request.types.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ExchangeAccountsService } from "./exchange-accounts.service.js";

// Key verification calls the exchange on the user's behalf: tighter limit than the global default.
const VERIFY_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller({ path: "exchange-accounts", version: "1" })
export class ExchangeAccountsController {
  constructor(private readonly service: ExchangeAccountsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<ExchangeAccountsResponse> {
    return this.service.list(user.id);
  }

  @Post()
  @Throttle(VERIFY_THROTTLE)
  connect(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectExchangeSchema)) body: ConnectExchangeInput,
    @Req() req: AppRequest,
  ): Promise<ExchangeAccountDto> {
    return this.service.connect(user.id, body, requestMeta(req));
  }

  @Put(":id/credentials")
  @Throttle(VERIFY_THROTTLE)
  replaceCredentials(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    // Validated in the service: the shape depends on the connection (API key or MetaTrader login).
    @Body() body: unknown,
    @Req() req: AppRequest,
  ): Promise<ExchangeAccountDto> {
    return this.service.replaceCredentials(user.id, id, body, requestMeta(req));
  }

  @Post(":id/sync")
  @HttpCode(202)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  requestSync(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() req: AppRequest,
  ): Promise<{ queued: boolean }> {
    return this.service.requestSync(user.id, id, requestMeta(req));
  }

  @Delete(":id")
  @HttpCode(204)
  disconnect(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.service.disconnect(user.id, id, requestMeta(req));
  }
}
