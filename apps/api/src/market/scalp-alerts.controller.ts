import { planLimits } from "@atc/coach";
import {
  type CockpitTf,
  type CreateScalpAlert,
  createScalpAlertSchema,
  isPinned,
  SCALP_KEY,
  type ScalpAlertDirection,
  type ScalpAlertDto,
  type ScalpAlertsPage,
  type ScalpSnapshot,
  UNLIMITED,
  type UpdateScalpAlert,
  updateScalpAlertSchema,
} from "@atc/shared";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../auth/decorators.js";
import type { AuthenticatedUser } from "../common/request.types.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";

type Row = {
  id: string;
  symbol: string;
  tf: string;
  direction: string;
  minCount: number;
  noNews: boolean;
  cooldownMin: number;
  enabled: boolean;
  lastFiredAt: Date | null;
  createdAt: Date;
  planStopRanges: number;
  planTargetR: number;
  planRiskUsd: { toString(): string } | null;
};
const dto = (r: Row): ScalpAlertDto => ({
  id: r.id,
  symbol: r.symbol,
  tf: r.tf as CockpitTf,
  direction: r.direction as ScalpAlertDirection,
  minCount: r.minCount,
  noNews: r.noNews,
  cooldownMin: r.cooldownMin,
  enabled: r.enabled,
  lastFiredAt: r.lastFiredAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  planStopRanges: r.planStopRanges,
  planTargetR: r.planTargetR,
  planRiskUsd: r.planRiskUsd === null ? null : Number(r.planRiskUsd),
});

/** Scalp Cockpit alerts: the worker checks them every minute; this keeps the list. */
@Injectable()
export class ScalpAlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<ScalpAlertsPage> {
    const [rows, limits] = await Promise.all([
      this.prisma.client.scalpAlert.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      planLimits(this.prisma.client, userId),
    ]);
    return { items: rows.map(dto), limit: limits.scalpAlerts };
  }

  async create(userId: string, input: CreateScalpAlert): Promise<ScalpAlertDto> {
    const db = this.prisma.client;
    const [limits, count, snap] = await Promise.all([
      planLimits(db, userId),
      db.scalpAlert.count({ where: { userId } }),
      db.marketSnapshot.findUnique({ where: { key: SCALP_KEY } }),
    ]);
    if (limits.scalpAlerts !== UNLIMITED && count >= limits.scalpAlerts)
      throw new ForbiddenException(
        `Your plan keeps ${limits.scalpAlerts} scalp alert${limits.scalpAlerts === 1 ? "" : "s"}. Delete one or upgrade for more.`,
      );
    const coin = (snap?.data as ScalpSnapshot | undefined)?.coins?.find(
      (c) => c.symbol === input.symbol,
    );
    if (!coin) throw new BadRequestException("This market is not in the scan right now.");
    if (
      limits.marketPulseCoins !== UNLIMITED &&
      coin.rank > limits.marketPulseCoins &&
      !isPinned(coin.symbol)
    )
      throw new ForbiddenException("Your plan covers the top 20 coins, gold and silver.");
    const row = await db.scalpAlert.create({ data: { userId, ...input } });
    return dto(row);
  }

  async update(userId: string, id: string, patch: UpdateScalpAlert): Promise<ScalpAlertDto> {
    const found = await this.prisma.client.scalpAlert.findFirst({ where: { id, userId } });
    if (!found) throw new NotFoundException("Alert not found");
    const row = await this.prisma.client.scalpAlert.update({
      where: { id },
      // A changed rule starts fresh: it fires the next time it holds.
      data: { ...patch, lastMet: false },
    });
    return dto(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const res = await this.prisma.client.scalpAlert.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw new NotFoundException("Alert not found");
  }
}

@Controller({ path: "scalp-alerts", version: "1" })
export class ScalpAlertsController {
  constructor(private readonly alerts: ScalpAlertsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<ScalpAlertsPage> {
    return this.alerts.list(user.id);
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createScalpAlertSchema)) input: CreateScalpAlert,
  ): Promise<ScalpAlertDto> {
    return this.alerts.create(user.id, input);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateScalpAlertSchema)) patch: UpdateScalpAlert,
  ): Promise<ScalpAlertDto> {
    return this.alerts.update(user.id, id, patch);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.alerts.remove(user.id, id);
  }
}
