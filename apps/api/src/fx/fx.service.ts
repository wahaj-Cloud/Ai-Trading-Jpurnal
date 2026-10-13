import type { FxRatesDto } from "@atc/shared";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { parseProviderRates } from "./fx.parse.js";

/** Rates are refreshed at most twice a day; the provider itself publishes once a day. */
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
/** Each API instance re-reads the table at most this often. */
const MEMO_MS = 10 * 60 * 1000;
const SOURCE = "ExchangeRate-API (open.er-api.com)";

/**
 * Daily USD exchange rates for showing amounts in the trader's own currency. Rates live in the
 * database so every instance shares them and a provider outage keeps the last good table; the
 * first request after they go stale refreshes them (one refresh in flight per instance).
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private memo: { at: number; dto: FxRatesDto } | null = null;
  private refreshing: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async latest(): Promise<FxRatesDto> {
    if (this.memo && Date.now() - this.memo.at < MEMO_MS) return this.memo.dto;

    let rows = await this.prisma.client.fxRate.findMany();
    const fetchedAt = rows.reduce((min, r) => Math.min(min, r.fetchedAt.getTime()), Infinity);
    const stale = rows.length === 0 || Date.now() - fetchedAt > REFRESH_AFTER_MS;
    if (stale && this.env.NODE_ENV !== "test") {
      this.refreshing ??= this.refresh().finally(() => {
        this.refreshing = null;
      });
      try {
        await this.refreshing;
        rows = await this.prisma.client.fxRate.findMany();
      } catch (err) {
        // Keep serving the last good table; amounts simply use slightly older rates.
        this.logger.warn(`Exchange-rate refresh failed: ${(err as Error).message}`);
      }
    }

    const rates: Record<string, number> = { USD: 1 };
    for (const r of rows) rates[r.currency] = Number(r.perUsd);
    const first = rows[0];
    const dto: FxRatesDto = {
      base: "USD",
      asOf: (first?.asOf ?? new Date(0)).toISOString(),
      fetchedAt: (first?.fetchedAt ?? new Date(0)).toISOString(),
      source: first?.source ?? SOURCE,
      rates,
    };
    // Don't memoise an empty table: retry on the next request instead.
    if (rows.length > 0) this.memo = { at: Date.now(), dto };
    return dto;
  }

  private async refresh(): Promise<void> {
    const res = await fetch(this.env.FX_RATES_URL, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`Provider answered ${res.status}`);
    const { asOf, rates } = parseProviderRates(await res.json());
    const fetchedAt = new Date();
    const data = Object.entries(rates).map(([currency, perUsd]) => ({
      currency,
      perUsd: perUsd.toString(),
      asOf,
      fetchedAt,
      source: SOURCE,
    }));
    // Replace the whole table at once so readers never see a mix of two days.
    await this.prisma.client.$transaction([
      this.prisma.client.fxRate.deleteMany(),
      this.prisma.client.fxRate.createMany({ data }),
    ]);
    this.memo = null;
    this.logger.log(
      `Exchange rates refreshed: ${data.length} currencies as of ${asOf.toISOString()}`,
    );
  }
}
