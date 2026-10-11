import { getRiskLimits, goalsFor, notificationDto, riskStatus } from "@atc/notify";
import {
  type GoalDto,
  type GoalInput,
  MAX_GOALS,
  type NotificationPrefs,
  type NotificationsPage,
  notificationPrefsSchema,
  type RiskLimits,
  type RiskStatusDto,
} from "@atc/shared";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

const PAGE = 30;

/** Goals, risk limits and notifications: the trader's own guard-rails and messages. */
@Injectable()
export class EngagementService {
  constructor(private readonly prisma: PrismaService) {}

  riskLimits(userId: string): Promise<RiskLimits> {
    return getRiskLimits(this.prisma.client, userId);
  }

  async saveRiskLimits(userId: string, input: RiskLimits): Promise<RiskLimits> {
    await this.prisma.client.riskLimit.upsert({
      where: { userId },
      create: { userId, ...input },
      update: input,
    });
    return this.riskLimits(userId);
  }

  riskStatus(userId: string): Promise<RiskStatusDto> {
    return riskStatus(this.prisma.client, userId);
  }

  goals(userId: string): Promise<GoalDto[]> {
    return goalsFor(this.prisma.client, userId);
  }

  async createGoal(userId: string, input: GoalInput): Promise<GoalDto[]> {
    const db = this.prisma.client;
    if ((await db.goal.count({ where: { userId } })) >= MAX_GOALS) {
      throw new BadRequestException(`You can have up to ${MAX_GOALS} goals.`);
    }
    const duplicate = await db.goal.findFirst({
      where: { userId, period: input.period, metric: input.metric },
    });
    if (duplicate) {
      await db.goal.update({ where: { id: duplicate.id }, data: { target: input.target } });
    } else {
      await db.goal.create({ data: { userId, ...input } });
    }
    return this.goals(userId);
  }

  async deleteGoal(userId: string, id: string): Promise<void> {
    const res = await this.prisma.client.goal.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw new NotFoundException("Goal not found");
  }

  async notifications(userId: string, cursor?: string): Promise<NotificationsPage> {
    const db = this.prisma.client;
    const rows = await db.notification.findMany({
      where: { userId, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { id: "desc" }, // UUIDv7: time-ordered
      take: PAGE + 1,
    });
    const unread = await db.notification.count({ where: { userId, readAt: null } });
    const page = rows.slice(0, PAGE);
    return {
      items: page.map(notificationDto),
      unread,
      nextCursor: rows.length > PAGE ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.client.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, ids: string[] | "all"): Promise<void> {
    await this.prisma.client.notification.updateMany({
      where: { userId, readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) },
      data: { readAt: new Date() },
    });
  }

  async prefs(userId: string): Promise<NotificationPrefs> {
    const s = await this.prisma.client.userSettings.findUnique({
      where: { userId },
      select: { notificationPrefs: true },
    });
    const parsed = notificationPrefsSchema.safeParse(s?.notificationPrefs ?? {});
    return parsed.success ? parsed.data : notificationPrefsSchema.parse({});
  }

  async savePrefs(userId: string, prefs: NotificationPrefs): Promise<NotificationPrefs> {
    await this.prisma.client.userSettings.upsert({
      where: { userId },
      create: { userId, notificationPrefs: prefs },
      update: { notificationPrefs: prefs },
    });
    return prefs;
  }
}
