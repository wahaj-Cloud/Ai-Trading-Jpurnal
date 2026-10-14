import {
  type BacktestInput,
  type BacktestRunDto,
  type BacktestRunsDto,
  type BacktestTradeChartDto,
  type BacktestTradesPage,
  type BacktestTradesQuery,
  backtestInputSchema,
  backtestTradesQuerySchema,
  type WhatIfFilters,
  type WhatIfResultDto,
  type WhatIfScenarioDto,
  type WhatIfScenarioInput,
  type WhatIfTeaserDto,
  whatIfFiltersSchema,
  whatIfScenarioInputSchema,
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
  Query,
  Res,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { CurrentUser } from "../auth/decorators.js";
import type { AuthenticatedUser } from "../common/request.types.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { BacktestsService } from "./backtests.service.js";
import { WhatIfService } from "./what-if.service.js";

@Controller({ path: "what-if", version: "1" })
export class WhatIfController {
  constructor(private readonly whatIf: WhatIfService) {}

  @Post("run")
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  run(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(whatIfFiltersSchema)) filters: WhatIfFilters,
  ): Promise<WhatIfResultDto> {
    return this.whatIf.run(user.id, filters);
  }

  @Get("teaser")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  teaser(@CurrentUser() user: AuthenticatedUser): Promise<WhatIfTeaserDto> {
    return this.whatIf.teaser(user.id);
  }

  @Get("scenarios")
  scenarios(@CurrentUser() user: AuthenticatedUser): Promise<WhatIfScenarioDto[]> {
    return this.whatIf.scenarios(user.id);
  }

  @Post("scenarios")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(whatIfScenarioInputSchema)) input: WhatIfScenarioInput,
  ): Promise<WhatIfScenarioDto> {
    return this.whatIf.saveScenario(user.id, input);
  }

  @Delete("scenarios/:id")
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.whatIf.deleteScenario(user.id, id);
  }
}

@Controller({ path: "backtests", version: "1" })
export class BacktestsController {
  constructor(private readonly backtests: BacktestsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<BacktestRunsDto> {
    return this.backtests.list(user.id);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(backtestInputSchema)) input: BacktestInput,
  ): Promise<BacktestRunDto> {
    return this.backtests.create(user.id, input);
  }

  @Get(":id")
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<BacktestRunDto> {
    return this.backtests.get(user.id, id);
  }

  @Get(":id/trades")
  trades(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(backtestTradesQuerySchema)) q: BacktestTradesQuery,
  ): Promise<BacktestTradesPage> {
    return this.backtests.trades(user.id, id, q);
  }

  @Get(":id/trades/:tradeId/chart")
  tradeChart(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("tradeId", new ParseUUIDPipe()) tradeId: string,
  ): Promise<BacktestTradeChartDto> {
    return this.backtests.tradeChart(user.id, id, tradeId);
  }

  @Get(":id/export")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.backtests.csv(user.id, id);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${file.filename}"`);
    res.setHeader("cache-control", "no-store");
    res.send(file.body);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.backtests.remove(user.id, id);
  }
}
