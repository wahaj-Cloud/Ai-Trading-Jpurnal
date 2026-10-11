import {
  type BehaviourSummaryDto,
  type ChatInput,
  type CoachNoteDto,
  type CoachStatusDto,
  type ConversationDto,
  type ConversationSummaryDto,
  chatInputSchema,
  dailyNoteRequestSchema,
  type ReviewedTradeDto,
  type StrategyInsightDto,
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
import { z } from "zod";
import { CurrentUser } from "../auth/decorators.js";
import type { AuthenticatedUser } from "../common/request.types.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { CoachService } from "./coach.service.js";

const behaviourQuery = z
  .object({
    days: z.coerce
      .number()
      .pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]))
      .default(30),
  })
  .strict();
const strategyQuery = z
  .object({ days: z.coerce.number().int().min(7).max(3650).default(90) })
  .strict();
const notesQuery = z.object({ limit: z.coerce.number().int().min(1).max(60).default(20) }).strict();

@Controller({ path: "coach", version: "1" })
export class CoachController {
  constructor(private readonly coach: CoachService) {}

  @Get("status")
  status(@CurrentUser() user: AuthenticatedUser): Promise<CoachStatusDto> {
    return this.coach.status(user.id);
  }

  @Get("behaviour")
  behaviour(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(behaviourQuery)) q: z.infer<typeof behaviourQuery>,
  ): Promise<BehaviourSummaryDto> {
    return this.coach.behaviour(user.id, q.days);
  }

  @Get("notes")
  notes(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(notesQuery)) q: z.infer<typeof notesQuery>,
  ): Promise<CoachNoteDto[]> {
    return this.coach.notes(user.id, q.limit);
  }

  @Get("strategy")
  strategy(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(strategyQuery)) q: z.infer<typeof strategyQuery>,
  ): Promise<StrategyInsightDto[]> {
    return this.coach.strategy(user.id, q.days);
  }

  @Get("reviews")
  reviews(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(notesQuery)) q: z.infer<typeof notesQuery>,
  ): Promise<ReviewedTradeDto[]> {
    return this.coach.recentReviews(user.id, q.limit);
  }

  @Post("notes/daily")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async dailyNote(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(dailyNoteRequestSchema)) body: { date: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<CoachNoteDto | undefined> {
    const note = await this.coach.dailyNote(user.id, body.date);
    if (!note) res.status(204);
    return note ?? undefined;
  }

  @Get("conversations")
  conversations(@CurrentUser() user: AuthenticatedUser): Promise<ConversationSummaryDto[]> {
    return this.coach.conversations(user.id);
  }

  @Get("conversations/:id")
  conversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<ConversationDto> {
    return this.coach.conversation(user.id, id);
  }

  @Delete("conversations/:id")
  @HttpCode(204)
  async deleteConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.coach.deleteConversation(user.id, id);
  }

  @Post("chat")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  chat(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(chatInputSchema)) body: ChatInput,
  ): Promise<ConversationDto> {
    return this.coach.chat(user.id, body);
  }
}
