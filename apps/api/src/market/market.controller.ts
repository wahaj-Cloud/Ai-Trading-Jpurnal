import {
  type CockpitDto,
  type CockpitQuery,
  cockpitQuerySchema,
  type DeskEventDto,
  type DeskQuery,
  deskQuerySchema,
  type FlowFeedPage,
  type FlowFeedQuery,
  type FlowSummaryDto,
  type FlowSummaryQuery,
  flowFeedQuerySchema,
  flowSummaryQuerySchema,
  type LiquidationDto,
  type LiquidationMapQuery,
  type LiquidationMapResponse,
  type LiveStreamQuery,
  type LiveTicketDto,
  liquidationMapQuerySchema,
  liveStreamQuerySchema,
  type MarketBiasDto,
  type MarketDeskResponse,
  type MarketOverviewDto,
  type MarketPulseDto,
  type MarketPulseQuery,
  marketPulseQuerySchema,
  type OrderflowQuery,
  type OrderflowResponse,
  orderflowQuerySchema,
  type PulseMyTradesDto,
  type PulseSymbolDto,
  type ScalpResponse,
  type TradeCheckQuery,
  type TradeCheckResponse,
  tradeCheckQuerySchema,
  type WhaleTradeDto,
} from "@atc/shared";
import {
  Controller,
  Get,
  Header,
  type MessageEvent,
  Module,
  Param,
  Post,
  Query,
  Sse,
} from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import type { Observable } from "rxjs";
import { z } from "zod";
import { CurrentUser, Public } from "../auth/decorators.js";
import type { AuthenticatedUser } from "../common/request.types.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { CockpitService } from "./cockpit.service.js";
import { FlowService } from "./flow.service.js";
import { LiveFlowService } from "./live-flow.service.js";
import { MarketService } from "./market.service.js";
import { OrderflowService } from "./orderflow.service.js";
import { PaperBotsController, PaperBotsService } from "./paper-bots.controller.js";
import { ScalpAlertsController, ScalpAlertsService } from "./scalp-alerts.controller.js";
import { TradeCheckService } from "./trade-check.service.js";
import { ZoneAlertsController, ZoneAlertsService } from "./zone-alerts.controller.js";

const symbolParam = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,20}USDT$/);

@Controller({ path: "market", version: "1" })
export class MarketController {
  constructor(
    private readonly market: MarketService,
    private readonly flow: FlowService,
    private readonly tradeCheck: TradeCheckService,
    private readonly orderflow: OrderflowService,
    private readonly cockpitService: CockpitService,
    private readonly live: LiveFlowService,
  ) {}

  /** A two-minute ticket the browser uses to open the live stream (plan included). */
  @Post("live/ticket")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  liveTicket(@CurrentUser() user: AuthenticatedUser): Promise<LiveTicketDto> {
    return this.live.ticket(user.id);
  }

  /**
   * Live order flow, once a second: Order Flow (one window, with its flow lines), Scalping (every
   * coin) or the Cockpit (one market). Opened with a ticket instead of a sign-in header, which a
   * browser stream cannot send.
   */
  @Public()
  @SkipThrottle()
  @Sse("live/stream")
  @Header("Cache-Control", "no-cache, no-transform")
  @Header("X-Accel-Buffering", "no")
  liveStream(
    @Query(new ZodValidationPipe(liveStreamQuerySchema)) q: LiveStreamQuery,
  ): Observable<MessageEvent> {
    return this.live.stream(q);
  }

  @Get("cockpit")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  cockpit(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(cockpitQuerySchema)) q: CockpitQuery,
  ): Promise<CockpitDto> {
    return this.cockpitService.get(user.id, q);
  }

  @Get("scalp")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  scalp(@CurrentUser() user: AuthenticatedUser): Promise<ScalpResponse> {
    return this.orderflow.scalp(user.id);
  }

  @Get("order-flow")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  orderFlow(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(orderflowQuerySchema)) q: OrderflowQuery,
  ): Promise<OrderflowResponse> {
    return this.orderflow.get(user.id, q);
  }

  @Get("check")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  check(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(tradeCheckQuerySchema)) q: TradeCheckQuery,
  ): Promise<TradeCheckResponse> {
    return this.tradeCheck.check(user.id, q);
  }

  @Get("flow")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  flowSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(flowSummaryQuerySchema)) q: FlowSummaryQuery,
  ): Promise<FlowSummaryDto> {
    return this.flow.summary(user.id, q);
  }

  @Get("flow/whales")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  whales(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(flowFeedQuerySchema)) q: FlowFeedQuery,
  ): Promise<FlowFeedPage<WhaleTradeDto>> {
    return this.flow.whales(user.id, q);
  }

  @Get("flow/liquidations")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  liquidations(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(flowFeedQuerySchema)) q: FlowFeedQuery,
  ): Promise<FlowFeedPage<LiquidationDto>> {
    return this.flow.liquidations(user.id, q);
  }

  @Get("bias")
  bias(@CurrentUser() user: AuthenticatedUser): Promise<MarketBiasDto> {
    return this.flow.bias(user.id);
  }

  @Get("pulse")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  pulse(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(marketPulseQuerySchema)) q: MarketPulseQuery,
  ): Promise<MarketPulseDto> {
    return this.market.pulse(user.id, q);
  }

  @Get("overview")
  overview(): Promise<MarketOverviewDto> {
    return this.market.overview();
  }

  @Get("desk")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  desk(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(deskQuerySchema)) q: DeskQuery,
  ): Promise<MarketDeskResponse> {
    return this.market.desk(user.id, q);
  }

  @Get("next-event")
  async nextEvent(): Promise<{ event: DeskEventDto | null }> {
    return { event: await this.market.nextEvent() };
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

@Module({
  controllers: [MarketController, ScalpAlertsController, ZoneAlertsController, PaperBotsController],
  providers: [
    MarketService,
    FlowService,
    TradeCheckService,
    OrderflowService,
    CockpitService,
    ScalpAlertsService,
    PaperBotsService,
    ZoneAlertsService,
    LiveFlowService,
  ],
})
export class MarketModule {}
