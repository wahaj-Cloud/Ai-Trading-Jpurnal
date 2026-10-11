import type { Prisma } from "@atc/db";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

export interface AuditEntry {
  actorId: string | null;
  action: string; // dot-namespaced verb, e.g. "user.settings.updated"
  entity: string;
  entityId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonObject;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Audit writes must never break the user action they describe; failures are logged loudly. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
          metadata: entry.metadata ?? {},
        },
      });
    } catch (err) {
      this.logger.error({ msg: "audit write failed", action: entry.action, err });
    }
  }
}
