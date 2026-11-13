import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

/** Most trades included in one export (a decade of active trading for almost everyone). */
const MAX_TRADES = 50_000;
const MAX_NOTIFICATIONS = 1_000;

/**
 * Everything a trader keeps in WickMentor, as one JSON document: profile, settings, connected
 * accounts (names and status only: keys never leave the vault), trades, journal, AI reviews and
 * notes, coach chats, goals and risk limits, setups and alerts, paper bots and their trades.
 * One request on demand (rate-limited), so the database transfer stays small.
 */
@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  async export(userId: string, now = new Date()) {
    const db = this.prisma.client;
    const [
      user,
      accounts,
      trades,
      openPositions,
      journal,
      reviews,
      notes,
      conversations,
      goals,
      riskLimit,
      setups,
      setupAlerts,
      scalpAlerts,
      zoneAlerts,
      bots,
      notifications,
    ] = await Promise.all([
      db.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          email: true,
          name: true,
          timezone: true,
          baseCurrency: true,
          displayCurrency: true,
          createdAt: true,
          settings: {
            select: {
              theme: true,
              pnlColorScheme: true,
              notificationPrefs: true,
              dashboardLayout: true,
              appPrefs: true,
            },
          },
          subscription: { select: { planCode: true, status: true, currentPeriodEnd: true } },
        },
      }),
      db.exchangeAccount.findMany({
        where: { userId },
        select: {
          id: true,
          exchange: true,
          label: true,
          status: true,
          apiKeyHint: true,
          lastSyncedAt: true,
          createdAt: true,
        },
      }),
      db.position.findMany({
        where: { userId },
        orderBy: { closedAt: "desc" },
        take: MAX_TRADES,
      }),
      db.openPosition.findMany({ where: { userId } }),
      db.journalEntry.findMany({ where: { userId } }),
      db.tradeReview.findMany({
        where: { userId },
        omit: { inputTokens: true, outputTokens: true },
      }),
      db.coachNote.findMany({ where: { userId }, omit: { inputTokens: true, outputTokens: true } }),
      db.coachConversation.findMany({
        where: { userId },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
            select: { role: true, content: true, createdAt: true },
          },
        },
      }),
      db.goal.findMany({ where: { userId } }),
      db.riskLimit.findUnique({ where: { userId } }),
      db.setup.findMany({ where: { userId, deletedAt: null } }),
      db.setupAlert.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 5_000 }),
      db.scalpAlert.findMany({ where: { userId } }),
      db.zoneAlert.findMany({ where: { userId } }),
      db.paperBot.findMany({ where: { userId }, include: { trades: true } }),
      db.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: MAX_NOTIFICATIONS,
        select: { kind: true, title: true, body: true, link: true, createdAt: true, readAt: true },
      }),
    ]);
    return {
      format: "wickmentor-export",
      version: 1,
      exportedAt: now.toISOString(),
      notes: [
        "Amounts are in US dollars (or the coin a contract settles in), as stored.",
        "Exchange API keys are never exported.",
        trades.length === MAX_TRADES
          ? `Only your latest ${MAX_TRADES} trades are included.`
          : "All your trades are included.",
      ],
      profile: user,
      exchangeAccounts: accounts,
      trades,
      openPositions,
      journal,
      aiTradeReviews: reviews,
      coachNotes: notes,
      coachConversations: conversations,
      goals,
      riskLimit,
      setups,
      setupAlerts,
      scalpAlerts,
      zoneAlerts,
      paperBots: bots,
      notifications,
    };
  }
}
