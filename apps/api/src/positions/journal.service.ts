import { Prisma } from "@atc/db";
import type { JournalData, JournalDto } from "@atc/shared";
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { journalDto } from "./positions.service.js";

/**
 * The trader's own review of a trade. Stored by the trade's stable source key (not its row ID),
 * so a journal entry survives the sync engine rebuilding the trade.
 */
@Injectable()
export class JournalService {
  constructor(private readonly prisma: PrismaService) {}

  async save(userId: string, positionId: string, input: JournalData): Promise<JournalDto> {
    const position = await this.find(userId, positionId);
    const data = {
      setup: input.setup || null,
      tags: input.tags,
      emotions: input.emotions,
      mistakes: input.mistakes,
      rating: input.rating,
      notes: input.notes?.trim() ? input.notes : null,
      stopPrice: input.stopPrice,
      targetPrice: input.targetPrice,
      screenshotUrls: input.screenshotUrls,
    };
    const upsert = () =>
      this.prisma.client.journalEntry.upsert({
        where: { userId_positionKey: { userId, positionKey: position.sourceKey } },
        create: { userId, accountId: position.accountId, positionKey: position.sourceKey, ...data },
        update: data,
      });
    try {
      return journalDto(await upsert());
    } catch (err) {
      // Two first saves at once (e.g. double submit): the loser retries as an update.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return journalDto(await upsert());
      }
      throw err;
    }
  }

  async remove(userId: string, positionId: string): Promise<void> {
    const position = await this.find(userId, positionId);
    await this.prisma.client.journalEntry.deleteMany({
      where: { userId, positionKey: position.sourceKey },
    });
  }

  private async find(userId: string, positionId: string) {
    const position = await this.prisma.client.position.findFirst({
      where: { id: positionId, userId },
      select: { sourceKey: true, accountId: true },
    });
    if (!position) throw new NotFoundException("Trade not found");
    return position;
  }
}
