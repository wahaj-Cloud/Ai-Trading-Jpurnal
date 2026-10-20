import { randomBytes } from "node:crypto";
import { planLimits } from "@atc/coach";
import {
  LIVE_FLOW_CHANNEL,
  LIVE_FLOW_KEY,
  type LiveStreamQuery,
  type LiveTick,
  type LiveTicketDto,
  type LiveView,
  liveViewOf,
  UNLIMITED,
} from "@atc/shared";
import {
  Inject,
  Injectable,
  Logger,
  type MessageEvent,
  type OnModuleDestroy,
  type OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { Redis } from "ioredis";
import { concat, from, interval, map, merge, type Observable, Subject, switchMap } from "rxjs";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** A stream ticket lives this long: enough to connect, short enough to be useless if leaked. */
const TICKET_TTL_S = 120;
const ticketKey = (t: string) => `live:ticket:${t}`;

interface Ticket {
  userId: string;
  /** Coins ranked within this are sent (null = all). Gold and silver always. */
  cap: number | null;
}

/**
 * Live order flow to browsers. The worker publishes one tick a second on Redis; each API instance
 * holds one subscription and sends every connected page only its part, within the plan.
 *
 * A browser cannot send its sign-in header on a stream, so the signed-in web app first asks for a
 * ticket (random, single purpose, two minutes) and the browser connects with it. A ticket only
 * reads market data the plan already shows.
 */
@Injectable()
export class LiveFlowService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveFlowService.name);
  private sub: Redis | null = null;
  private redis: Redis | null = null;
  readonly ticks$ = new Subject<LiveTick>();
  /** The same tick is cut the same way for many pages: one result per view and plan. */
  private cache: { at: number; views: Map<string, LiveView> } = { at: 0, views: new Map() };

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.env.NODE_ENV === "test") return;
    this.connect(
      new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null, family: 0 }),
      new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: 2, family: 0 }),
    );
    await this.sub?.subscribe(LIVE_FLOW_CHANNEL).catch((err: Error) => {
      this.logger.warn(`live flow subscribe failed: ${err.message}`);
    });
  }

  /** Wires the Redis connections (also used by tests). */
  connect(sub: Redis, redis: Redis): void {
    this.sub = sub;
    this.redis = redis;
    sub.on("error", (err) => this.logger.warn(`live flow subscriber: ${err.message}`));
    redis.on("error", (err) => this.logger.warn(`live flow redis: ${err.message}`));
    sub.on("message", (channel, raw) => {
      if (channel !== LIVE_FLOW_CHANNEL) return;
      const tick = parseTick(raw);
      if (tick) this.ticks$.next(tick);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.ticks$.complete();
    await this.sub?.quit().catch(() => undefined);
    await this.redis?.quit().catch(() => undefined);
  }

  async ticket(userId: string): Promise<LiveTicketDto> {
    if (!this.redis) throw new UnauthorizedException("Live data is not available right now");
    const limits = await planLimits(this.prisma.client, userId);
    const cap = limits.marketPulseCoins === UNLIMITED ? null : limits.marketPulseCoins;
    const ticket = randomBytes(24).toString("hex");
    const value: Ticket = { userId, cap };
    await this.redis.set(ticketKey(ticket), JSON.stringify(value), "EX", TICKET_TTL_S);
    return { ticket, expiresAt: new Date(Date.now() + TICKET_TTL_S * 1000).toISOString() };
  }

  private async redeem(ticket: string): Promise<Ticket> {
    const raw = await this.redis?.get(ticketKey(ticket));
    if (!raw) throw new UnauthorizedException("This live link has expired");
    return JSON.parse(raw) as Ticket;
  }

  private view(tick: LiveTick, q: LiveStreamQuery, cap: number | null): LiveView {
    if (this.cache.at !== tick.at) this.cache = { at: tick.at, views: new Map() };
    const key = `${q.view}|${q.w ?? ""}|${q.s ?? ""}|${cap ?? "all"}`;
    let v = this.cache.views.get(key);
    if (!v) {
      v = liveViewOf(tick, q, cap);
      this.cache.views.set(key, v);
    }
    return v;
  }

  /** The newest tick (kept 15 seconds by the worker), or null when the live feed is down. */
  async latestTick(): Promise<LiveTick | null> {
    const raw = await this.redis?.get(LIVE_FLOW_KEY);
    return raw ? parseTick(raw) : null;
  }

  /**
   * One page's live stream: the latest tick at once (so the page is live without waiting), then
   * every new one, and a heartbeat that keeps proxies from closing a quiet line.
   */
  stream(q: LiveStreamQuery): Observable<MessageEvent> {
    return from(this.redeem(q.ticket)).pipe(
      switchMap((t) => {
        const latest = from(this.latestTick()).pipe(switchMap((tick) => (tick ? [tick] : [])));
        return merge(
          concat(latest, this.ticks$).pipe(
            map((tick) => ({ type: "tick", data: this.view(tick, q, t.cap) }) as MessageEvent),
          ),
          interval(20_000).pipe(map(() => ({ type: "ping", data: "" }) as MessageEvent)),
        );
      }),
    );
  }
}

function parseTick(raw: string): LiveTick | null {
  try {
    const t = JSON.parse(raw) as LiveTick;
    return Number.isFinite(t?.at) && Array.isArray(t?.coins) ? t : null;
  } catch {
    return null;
  }
}
