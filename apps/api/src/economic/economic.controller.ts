import {
  type EconomicCalendarDto,
  type EconomicCalendarQuery,
  economicCalendarQuerySchema,
} from "@atc/shared";
import { Controller, Get, Query } from "@nestjs/common";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { EconomicService } from "./economic.service.js";

@Controller({ path: "economic-calendar", version: "1" })
export class EconomicController {
  constructor(private readonly economic: EconomicService) {}

  /** Events in a time window, optionally filtered by impact and currency. */
  @Get()
  list(
    @Query(new ZodValidationPipe(economicCalendarQuerySchema)) query: EconomicCalendarQuery,
  ): Promise<EconomicCalendarDto> {
    return this.economic.list(query);
  }
}
