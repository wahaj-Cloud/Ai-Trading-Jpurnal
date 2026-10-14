import { Prisma } from "@atc/db";
import {
  type MeResponse,
  normalizeLayout,
  resolveLimits,
  type UpdateProfileInput,
} from "@atc/shared";
import type { ClerkClient } from "@clerk/backend";
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { CLERK_CLIENT } from "../clerk/clerk.module.js";
import type { AuthenticatedUser } from "../common/request.types.js";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { type ProviderProfile, profileFromClerkUser } from "./provider-profile.js";

type RequestMeta = { ip: string | null; userAgent: string | null };

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CLERK_CLIENT) private readonly clerk: ClerkClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Returns the active user for a verified identity, creating it on first sight
   * (covers the window before the signup webhook arrives). Returns null for deleted accounts.
   */
  async resolveByAuthProviderId(authProviderId: string): Promise<AuthenticatedUser | null> {
    const existing = await this.prisma.client.user.findUnique({
      where: { authProviderId },
      select: {
        id: true,
        authProviderId: true,
        role: true,
        deletedAt: true,
        suspendedAt: true,
        email: true,
        emailVerified: true,
      },
    });
    if (existing) {
      if (existing.deletedAt || existing.suspendedAt) return null;
      // A listed admin whose verification we have not seen yet (e.g. accounts created before it
      // was recorded): refresh once from the identity provider instead of waiting for a webhook.
      if (
        !existing.emailVerified &&
        this.env.ADMIN_EMAILS.has(existing.email.toLowerCase()) &&
        this.dueForVerificationCheck(existing.id)
      ) {
        const profile = profileFromClerkUser(await this.clerk.users.getUser(authProviderId));
        if (profile?.emailVerified && profile.email === existing.email.toLowerCase()) {
          await this.prisma.client.user.update({
            where: { id: existing.id },
            data: { emailVerified: true },
          });
          existing.emailVerified = true;
        }
      }
      return toAuthUser(await this.syncRole(existing));
    }

    const clerkUser = await this.clerk.users.getUser(authProviderId);
    const profile = profileFromClerkUser(clerkUser);
    if (!profile) throw new ConflictException("Your account has no primary email address");
    const created = await this.upsertFromProvider(profile, "jit");
    return toAuthUser(
      await this.syncRole({
        ...created,
        email: profile.email,
        emailVerified: profile.emailVerified,
      }),
    );
  }

  /** At most one identity-provider lookup per user every 10 minutes (it runs before rate limits). */
  private readonly verificationChecks = new Map<string, number>();
  private dueForVerificationCheck(userId: string): boolean {
    const now = Date.now();
    const last = this.verificationChecks.get(userId) ?? 0;
    if (now - last < 10 * 60_000) return false;
    if (this.verificationChecks.size > 1_000) this.verificationChecks.clear();
    this.verificationChecks.set(userId, now);
    return true;
  }

  /**
   * Admin access follows the ADMIN_EMAILS setting, in both directions, and only for an email the
   * identity provider has verified (an unverified sign-up using an admin's address gets nothing).
   */
  private async syncRole<
    T extends { id: string; role: "USER" | "ADMIN"; email: string; emailVerified: boolean },
  >(user: T): Promise<T> {
    const wanted =
      user.emailVerified && this.env.ADMIN_EMAILS.has(user.email.toLowerCase()) ? "ADMIN" : "USER";
    if (wanted === user.role) return user;
    await this.prisma.client.user.update({ where: { id: user.id }, data: { role: wanted } });
    await this.audit.record({
      actorId: null,
      action: wanted === "ADMIN" ? "user.admin_granted" : "user.admin_revoked",
      entity: "user",
      entityId: user.id,
      metadata: { source: "ADMIN_EMAILS" },
    });
    return { ...user, role: wanted };
  }

  /** Idempotent: safe to call from both the webhook and just-in-time provisioning, concurrently. */
  async upsertFromProvider(profile: ProviderProfile, source: "jit" | "webhook") {
    const select = { id: true, authProviderId: true, role: true } as const;
    try {
      const existed = await this.prisma.client.user.findUnique({
        where: { authProviderId: profile.authProviderId },
        select: { ...select, deletedAt: true, providerUpdatedAt: true },
      });
      // A late "updated" event must never restore personal data onto a deleted account, nor
      // overwrite a newer profile (webhooks can arrive out of order).
      const stale =
        existed?.providerUpdatedAt &&
        profile.updatedAt &&
        profile.updatedAt <= existed.providerUpdatedAt;
      if (existed && (existed.deletedAt || stale)) {
        const { deletedAt: _deleted, providerUpdatedAt: _at, ...rest } = existed;
        return rest;
      }
      const user = await this.prisma.client.user.upsert({
        where: { authProviderId: profile.authProviderId },
        create: {
          authProviderId: profile.authProviderId,
          email: profile.email,
          name: profile.name,
          imageUrl: profile.imageUrl,
          emailVerified: profile.emailVerified,
          providerUpdatedAt: profile.updatedAt,
          settings: { create: {} },
          subscription: { create: { planCode: "FREE", status: "ACTIVE" } },
        },
        update: {
          email: profile.email,
          name: profile.name,
          imageUrl: profile.imageUrl,
          emailVerified: profile.emailVerified,
          providerUpdatedAt: profile.updatedAt,
        },
        select,
      });
      if (!existed) {
        await this.audit.record({
          actorId: user.id,
          action: "user.created",
          entity: "user",
          entityId: user.id,
          metadata: { source },
        });
      }
      return user;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Lost a race with a concurrent provisioning call: the row now exists.
      const raced = await this.prisma.client.user.findUnique({
        where: { authProviderId: profile.authProviderId },
        select,
      });
      if (raced) return raced;
      // The email belongs to a different identity (e.g. a second sign-in method). Never auto-merge.
      this.logger.warn({ msg: "email already linked to another identity", source });
      throw new ConflictException(
        "An account with this email already exists. Sign in with the method you used originally.",
      );
    }
  }

  /**
   * Account deleted at the identity provider: drop personal data, destroy every stored exchange key
   * and stop syncing, all in one transaction. Keeps the row for audit integrity.
   */
  async softDeleteByAuthProviderId(authProviderId: string): Promise<void> {
    const user = await this.prisma.client.user.findUnique({ where: { authProviderId } });
    if (!user || user.deletedAt) return;
    const deletedKeys = await this.prisma.client.$transaction(async (tx) => {
      const keys = await tx.exchangeCredential.deleteMany({
        where: { account: { userId: user.id } },
      });
      await tx.exchangeAccount.updateMany({
        where: { userId: user.id },
        data: { status: "DISCONNECTED", syncRetryAt: null },
      });
      await tx.openPosition.deleteMany({ where: { userId: user.id } });
      await tx.user.update({
        where: { id: user.id },
        data: {
          deletedAt: new Date(),
          // Frees the email for a future signup.
          email: `deleted+${user.id}@users.invalid`,
          name: null,
          imageUrl: null,
          emailVerified: false,
          role: "USER",
        },
      });
      return keys.count;
    });
    await this.audit.record({
      actorId: user.id,
      action: "user.deleted",
      entity: "user",
      entityId: user.id,
      metadata: { exchangeKeysDestroyed: deletedKeys },
    });
  }

  async getMe(userId: string): Promise<MeResponse> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      include: { settings: true, subscription: { include: { plan: true } } },
    });
    if (!user?.subscription) throw new NotFoundException("User not found");

    // A paused or canceled paid subscription falls back to the Free plan's limits.
    const lapsed = !["ACTIVE", "TRIALING", "PAST_DUE"].includes(user.subscription.status);
    const plan = lapsed
      ? await this.prisma.client.plan.findUniqueOrThrow({ where: { code: "FREE" } })
      : user.subscription.plan;
    const [activeExchanges, syncedExchanges, reviewed] = await Promise.all([
      this.prisma.client.exchangeAccount.count({ where: { userId, status: "ACTIVE" } }),
      this.prisma.client.exchangeAccount.count({
        where: { userId, backfillCompletedAt: { not: null } },
      }),
      this.prisma.client.journalEntry.findFirst({ where: { userId }, select: { id: true } }),
    ]);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      imageUrl: user.imageUrl,
      timezone: user.timezone,
      baseCurrency: user.baseCurrency,
      displayCurrency: user.displayCurrency,
      role: user.role,
      foundingMember: user.foundingMember,
      settings: {
        pnlColorScheme: user.settings?.pnlColorScheme === "colorblind" ? "colorblind" : "standard",
        dashboardLayout: normalizeLayout(user.settings?.dashboardLayout ?? null),
      },
      plan: {
        code: plan.code,
        name: plan.name,
        limits: resolveLimits(plan.code, plan.limits),
        status: user.subscription.status,
      },
      onboarding: {
        exchangeConnected: activeExchanges > 0,
        firstSyncCompleted: syncedExchanges > 0,
        firstTradeReviewed: reviewed !== null,
      },
    };
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
    meta: RequestMeta,
  ): Promise<MeResponse> {
    const { pnlColorScheme, dashboardLayout, ...userFields } = input;
    // Stored normalised, so only known widgets (each once) are ever kept.
    const layout = dashboardLayout ? normalizeLayout(dashboardLayout) : undefined;
    const settings = {
      ...(pnlColorScheme && { pnlColorScheme }),
      ...(layout && { dashboardLayout: layout as unknown as Prisma.InputJsonValue }),
    };
    await this.prisma.client.$transaction(async (tx) => {
      if (Object.keys(userFields).length > 0) {
        await tx.user.update({ where: { id: userId }, data: userFields });
      }
      if (Object.keys(settings).length > 0) {
        await tx.userSettings.upsert({
          where: { userId },
          create: { userId, ...settings },
          update: settings,
        });
      }
    });
    await this.audit.record({
      actorId: userId,
      action: "user.profile.updated",
      entity: "user",
      entityId: userId,
      ...meta,
      metadata: { fields: Object.keys(input) },
    });
    return this.getMe(userId);
  }
}

function toAuthUser(u: {
  id: string;
  authProviderId: string;
  role: "USER" | "ADMIN";
}): AuthenticatedUser {
  return { id: u.id, authProviderId: u.authProviderId, role: u.role };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
