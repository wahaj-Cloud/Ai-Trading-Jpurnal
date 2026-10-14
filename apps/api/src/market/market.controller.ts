import {
  type LiquidationMapQuery,
  type LiquidationMapResponse,
  liquidationMapQuerySchema,
  type MarketPulseDto,
  type MarketPulseQuery,
  marketPulseQuerySchema,
  type PulseMyTradesDto,
  type PulseSymbolDto,
} from "@atc/shared";
import { Controller, Get, Module, Param, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { CurrentUser } from "../auth/decorators.js";
import type { AuthenticatedUser } from "../common/request.types.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { MarketService } from "./market.service.js";

const symbolParam = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,20}USDT$/);

@Controller({ path: "market", version: "1" })
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get("pulse")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  pulse(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(marketPulseQuerySchema)) q: MarketPulseQuery,
  ): Promise<MarketPulseDto> {
    return this.market.pulse(user.id, q);
  }

  @Get("liquidation-map")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  liquidationMap(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(liquidationMapQuerySchema)) q: LiquidationMapQuery,
  ): Promise<LiquidationMapResponse> {
    return this.market.liquidationMap(user.id, q);
  }

  @Get("pulse/me")
  myTrades(@CurrentUser() user: AuthenticatedUser): Promise<PulseMyTradesDto> {
    return this.market.myTrades(user.id);
  }

  @Get("pulse/:symbol")
  symbol(
    @CurrentUser() user: AuthenticatedUser,
    @Param("symbol", new ZodValidationPipe(symbolParam)) symbol: string,
  ): Promise<PulseSymbolDto> {
    return this.market.symbol(user.id, symbol);
  }
}

@Module({ controllers: [MarketController], providers: [MarketService] })
export class MarketModule {}
