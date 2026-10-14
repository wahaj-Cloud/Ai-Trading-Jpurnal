import {
  type EconomicCalendarDto,
  type EconomicCalendarQuery,
  economicCalendarQuerySchema,
} from "@atc/shared";
import { Controller, Get, Header, type MessageEvent, Query, Sse } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { interval, map, merge, type Observable } from "rxjs";
import { Public } from "../auth/decorators.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { EconomicService } from "./economic.service.js";
import { EconomicLiveService } from "./economic-live.service.js";

@Controller({ path: "economic-calendar", version: "1" })
export class EconomicController {
  constructor(
    private readonly economic: EconomicService,
    private readonly live: EconomicLiveService,
  ) {}

  /** Events in a time window, optionally filtered by impact and currency. */
  @Get()
  list(
    @Query(new ZodValidationPipe(economicCalendarQuerySchema)) query: EconomicCalendarQuery,
  ): Promise<EconomicCalendarDto> {
    return this.economic.list(query);
  }

  /**
   * Server-sent events: each released figure the moment it arrives, plus a heartbeat so proxies
   * keep the line open. Public market data only (no user data), so no sign-in is needed.
   */
  @Public()
  @SkipThrottle()
  @Sse("stream")
  @Header("Cache-Control", "no-cache, no-transform")
  @Header("X-Accel-Buffering", "no")
  stream(): Observable<MessageEvent> {
    return merge(
      this.live.updates$.pipe(map((u) => ({ type: "release", data: u }) as MessageEvent)),
      interval(20_000).pipe(map(() => ({ type: "ping", data: "" }) as MessageEvent)),
    );
  }
}
