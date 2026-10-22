import { planLimits } from "@atc/coach";
import { snapshotsOf } from "@atc/db";
import {
  type CreateZoneAlert,
  createZoneAlertSchema,
  isPinned,
  SCALP_KEY,
  type ScalpSnapshot,
  UNLIMITED,
  type UpdateZoneAlert,
  updateZoneAlertSchema,
  type ZoneAlertDto,
  type ZoneAlertSide,
  type ZoneAlertsPage,
  type ZoneTf,
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
  tfs: string[];
  side: string;
  freshOnly: boolean;
  cooldownMin: number;
  enabled: boolean;
  lastFiredAt: Date | null;
  createdAt: Date;
};
const dto = (r: Row): ZoneAlertDto => ({
  id: r.id,
  symbol: r.symbol,
  tfs: r.tfs as ZoneTf[],
  side: r.side as ZoneAlertSide,
  freshOnly: r.freshOnly,
  cooldownMin: r.cooldownMin,
  enabled: r.enabled,
  lastFiredAt: r.lastFiredAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

/** Supply/demand zone alerts: the worker checks them every second; this keeps the list. */
@Injectable()
export class ZoneAlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<ZoneAlertsPage> {
    const [rows, limits] = await Promise.all([
      this.prisma.client.zoneAlert.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      planLimits(this.prisma.client, userId),
    ]);
    return { items: rows.map(dto), limit: limits.zoneAlerts };
  }

  async create(userId: string, input: CreateZoneAlert): Promise<ZoneAlertDto> {
    const db = this.prisma.client;
    const [limits, count, snap] = await Promise.all([
      planLimits(db, userId),
      db.zoneAlert.count({ where: { userId } }),
      snapshotsOf(db).get(SCALP_KEY),
    ]);
    if (limits.zoneAlerts !== UNLIMITED && count >= limits.zoneAlerts)
      throw new ForbiddenException(
        `Your plan keeps ${limits.zoneAlerts} zone alert${limits.zoneAlerts === 1 ? "" : "s"}. Delete one or upgrade for more.`,
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
    const row = await db.zoneAlert.create({ data: { userId, ...input } });
    return dto(row);
  }

  async update(userId: string, id: string, patch: UpdateZoneAlert): Promise<ZoneAlertDto> {
    const found = await this.prisma.client.zoneAlert.findFirst({ where: { id, userId } });
    if (!found) throw new NotFoundException("Alert not found");
    const row = await this.prisma.client.zoneAlert.update({ where: { id }, data: patch });
    return dto(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const res = await this.prisma.client.zoneAlert.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw new NotFoundException("Alert not found");
  }
}

@Controller({ path: "zone-alerts", version: "1" })
export class ZoneAlertsController {
  constructor(private readonly alerts: ZoneAlertsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<ZoneAlertsPage> {
    return this.alerts.list(user.id);
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createZoneAlertSchema)) input: CreateZoneAlert,
  ): Promise<ZoneAlertDto> {
    return this.alerts.create(user.id, input);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateZoneAlertSchema)) patch: UpdateZoneAlert,
  ): Promise<ZoneAlertDto> {
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
