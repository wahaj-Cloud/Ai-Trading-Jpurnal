import {
  type ImportResult,
  importRequestSchema,
  type JournalData,
  type JournalDto,
  journalInputSchema,
  type PositionsPage,
  type PositionsQuery,
  positionsQuerySchema,
  type TradeDetailDto,
  type TradeReviewDto,
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
  Query,
  Req,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { CurrentUser } from "../auth/decorators.js";
import { CoachService } from "../coach/coach.service.js";
import { type AppRequest, type AuthenticatedUser, requestMeta } from "../common/request.types.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { JournalService } from "./journal.service.js";
import { PositionsService } from "./positions.service.js";

const reviewRequestSchema = z.object({ force: z.boolean().default(false) }).strict();

@Controller({ version: "1" })
export class PositionsController {
  constructor(
    private readonly positions: PositionsService,
    private readonly journal: JournalService,
    private readonly coach: CoachService,
  ) {}

  @Get("positions")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(positionsQuerySchema)) query: PositionsQuery,
  ): Promise<PositionsPage> {
    return this.positions.list(user.id, query);
  }

  @Get("positions/:id")
  async detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<TradeDetailDto> {
    const detail = await this.positions.detail(user.id, id);
    const [review, ctx] = await Promise.all([
      this.coach.tradeReview(user.id, id),
      this.coach.tradeContext(user.id, id),
    ]);
    return { ...detail, review, context: ctx.context, contextStatus: ctx.status };
  }

  /** Recomputes the trade's market context from candles (queued for the worker). */
  @Post("positions/:id/context")
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async requestContext(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.coach.requestContext(user.id, id);
  }

  /** Asks the AI coach to write (or, with force, rewrite) this trade's review. */
  @Post("positions/:id/review")
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  requestReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(reviewRequestSchema)) body: { force: boolean },
  ): Promise<TradeReviewDto> {
    return this.coach.requestReview(user.id, id, body.force);
  }

  /** Replaces the trade's journal entry (creates it on first save). */
  @Put("positions/:id/journal")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  saveJournal(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(journalInputSchema)) body: JournalData,
  ): Promise<JournalDto> {
    return this.journal.save(user.id, id, body);
  }

  @Delete("positions/:id/journal")
  @HttpCode(204)
  async deleteJournal(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.journal.remove(user.id, id);
  }

  /** Receives validated template rows in chunks (the web app parses the file). */
  @Post("imports/positions")
  @HttpCode(200)
  // A full 5,000-row file is 25 requests.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  importRows(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(importRequestSchema)) body: z.infer<typeof importRequestSchema>,
    @Req() req: AppRequest,
  ): Promise<ImportResult> {
    return this.positions.importRows(user.id, body.rows, requestMeta(req));
  }
}
