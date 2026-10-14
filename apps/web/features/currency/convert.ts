import {
  type AnalyticsDto,
  type BehaviourSummaryDto,
  type BucketDto,
  type CoachNoteDto,
  type OpenPositionsDto,
  type PositionDto,
  type PositionsPage,
  type PulseMyTradesDto,
  type ReportDto,
  type ReviewedTradeDto,
  type StrategyInsightDto,
  type TradeDetailDto,
  USD_SETTLEMENT_ASSETS,
  type WhatIfResultDto,
  type WhatIfTeaserDto,
} from "@atc/shared";

/**
 * Display currency. Every amount is stored and calculated in USD; for display it is multiplied by
 * the latest daily rate. Amounts settled in a coin (inverse contracts, e.g. 0.002 BTC) are never
 * converted, and prices (entry, exit, mark) stay in the market's own quote currency.
 */
export interface Display {
  /** ISO code amounts are shown in. */
  code: string;
  /** Units of `code` per 1 USD. */
  rate: number;
  /** When the provider published the rate (ISO), null for USD. */
  asOf: string | null;
  /** Set when the chosen currency had no rate, so amounts fell back to USD. */
  unavailable?: string;
}

export const USD_DISPLAY: Display = { code: "USD", rate: 1, asOf: null };

const USD_LIKE: ReadonlySet<string> = new Set(USD_SETTLEMENT_ASSETS);
const isIdentity = (d: Display) => d.code === "USD" && d.rate === 1;

/** Converts a decimal string; keeps 6 decimals so sums of converted values stay exact enough. */
function money(value: string, rate: number): string {
  return String(Math.round(Number(value) * rate * 1e6) / 1e6);
}
function moneyOrNull(value: string | null, rate: number): string | null {
  return value === null ? null : money(value, rate);
}

function bucket(b: BucketDto, rate: number): BucketDto {
  return { ...b, pnl: money(b.pnl, rate), avgPnl: moneyOrNull(b.avgPnl, rate) };
}

export function convertAnalytics(dto: AnalyticsDto, d: Display): AnalyticsDto {
  if (isIdentity(d)) return dto;
  const r = d.rate;
  const s = dto.summary;
  const buckets = (xs: BucketDto[]) => xs.map((b) => bucket(b, r));
  return {
    ...dto,
    currency: d.code,
    summary: {
      ...s,
      netPnl: money(s.netPnl, r),
      grossProfit: money(s.grossProfit, r),
      grossLoss: money(s.grossLoss, r),
      expectancy: moneyOrNull(s.expectancy, r),
      avgWin: moneyOrNull(s.avgWin, r),
      avgLoss: moneyOrNull(s.avgLoss, r),
      largestWin: moneyOrNull(s.largestWin, r),
      largestLoss: moneyOrNull(s.largestLoss, r),
      fees: money(s.fees, r),
      funding: money(s.funding, r),
      maxDrawdown: money(s.maxDrawdown, r),
      currentDrawdown: money(s.currentDrawdown, r),
      bestDay: s.bestDay && { ...s.bestDay, pnl: money(s.bestDay.pnl, r) },
      worstDay: s.worstDay && { ...s.worstDay, pnl: money(s.worstDay.pnl, r) },
    },
    today: { ...dto.today, pnl: money(dto.today.pnl, r) },
    thisMonth: { ...dto.thisMonth, pnl: money(dto.thisMonth.pnl, r) },
    daily: dto.daily.map((x) => ({
      ...x,
      pnl: money(x.pnl, r),
      cumulative: money(x.cumulative, r),
      drawdown: money(x.drawdown, r),
    })),
    monthly: dto.monthly.map((x) => ({ ...x, pnl: money(x.pnl, r) })),
    bySymbol: buckets(dto.bySymbol),
    byWeekday: buckets(dto.byWeekday),
    byHour: buckets(dto.byHour),
    bySession: buckets(dto.bySession),
    byDirection: buckets(dto.byDirection),
    bySetup: buckets(dto.bySetup),
    byMistake: buckets(dto.byMistake),
    byEmotion: buckets(dto.byEmotion),
    byTag: buckets(dto.byTag),
  };
}

export function convertPosition(p: PositionDto, d: Display): PositionDto {
  if (isIdentity(d) || !USD_LIKE.has(p.settleAsset)) return p;
  const r = d.rate;
  return {
    ...p,
    settleAsset: d.code,
    grossPnl: moneyOrNull(p.grossPnl, r),
    fees: moneyOrNull(p.fees, r),
    funding: moneyOrNull(p.funding, r),
    netPnl: moneyOrNull(p.netPnl, r),
  };
}

export function convertPositionsPage(page: PositionsPage, d: Display): PositionsPage {
  return isIdentity(d) ? page : { ...page, items: page.items.map((p) => convertPosition(p, d)) };
}

export function convertTradeDetail(dto: TradeDetailDto, d: Display): TradeDetailDto {
  if (isIdentity(d) || !USD_LIKE.has(dto.trade.settleAsset)) return dto;
  return {
    ...dto,
    trade: convertPosition(dto.trade, d),
    risk: { ...dto.risk, riskAmount: moneyOrNull(dto.risk.riskAmount, d.rate) },
  };
}

export function convertOpenPositions(dto: OpenPositionsDto, d: Display): OpenPositionsDto {
  if (isIdentity(d)) return dto;
  const r = d.rate;
  return {
    ...dto,
    unrealizedPnl: money(dto.unrealizedPnl, r),
    items: dto.items.map((p) =>
      USD_LIKE.has(p.settleAsset)
        ? {
            ...p,
            settleAsset: d.code,
            unrealizedPnl: moneyOrNull(p.unrealizedPnl, r),
            notional: moneyOrNull(p.notional, r),
          }
        : p,
    ),
  };
}

export function convertBehaviour(dto: BehaviourSummaryDto, d: Display): BehaviourSummaryDto {
  if (isIdentity(d)) return dto;
  return {
    ...dto,
    costByBehaviour: dto.costByBehaviour.map((c) => ({ ...c, netPnl: money(c.netPnl, d.rate) })),
  };
}

export function convertReviews(list: ReviewedTradeDto[], d: Display): ReviewedTradeDto[] {
  if (isIdentity(d)) return list;
  return list.map((t) =>
    USD_LIKE.has(t.settleAsset)
      ? { ...t, settleAsset: d.code, netPnl: money(t.netPnl, d.rate) }
      : t,
  );
}

export function convertReport(dto: ReportDto, d: Display): ReportDto {
  if (isIdentity(d)) return dto;
  return {
    ...dto,
    analytics: convertAnalytics(dto.analytics, d),
    behaviour: convertBehaviour(dto.behaviour, d),
    bestTrades: dto.bestTrades.map((p) => convertPosition(p, d)),
    worstTrades: dto.worstTrades.map((p) => convertPosition(p, d)),
  };
}

export function convertNotes(notes: CoachNoteDto[], d: Display): CoachNoteDto[] {
  if (isIdentity(d)) return notes;
  return notes.map((n) => ({ ...n, stats: { ...n.stats, netPnl: money(n.stats.netPnl, d.rate) } }));
}

export function convertInsights(list: StrategyInsightDto[], d: Display): StrategyInsightDto[] {
  if (isIdentity(d)) return list;
  return list.map((i) => ({
    ...i,
    withCheck: { ...i.withCheck, netPnl: money(i.withCheck.netPnl, d.rate) },
    againstCheck: { ...i.againstCheck, netPnl: money(i.againstCheck.netPnl, d.rate) },
  }));
}

/** One USD amount in the display currency (null stays null). */
export function toDisplay(value: string | null, d: Display): string | null {
  return value === null || isIdentity(d) ? value : money(value, d.rate);
}

export function convertWhatIf(dto: WhatIfResultDto, d: Display): WhatIfResultDto {
  if (isIdentity(d)) return dto;
  const m = (v: string) => money(v, d.rate);
  const sum = (s: WhatIfResultDto["actual"]) => ({
    ...s,
    netPnl: m(s.netPnl),
    expectancy: s.expectancy === null ? null : m(s.expectancy),
    maxDrawdown: m(s.maxDrawdown),
  });
  return {
    ...dto,
    actual: sum(dto.actual),
    scenario: sum(dto.scenario),
    difference: {
      ...dto.difference,
      netPnl: m(dto.difference.netPnl),
      maxDrawdown: m(dto.difference.maxDrawdown),
    },
    reasons: dto.reasons.map((r) => ({ ...r, pnl: m(r.pnl) })),
    curve: dto.curve.map((c) => ({ ...c, actual: m(c.actual), scenario: m(c.scenario) })),
  };
}

export function convertTeaser(dto: WhatIfTeaserDto, d: Display): WhatIfTeaserDto {
  return {
    ...dto,
    difference: toDisplay(dto.difference, d),
    drawdownBefore: toDisplay(dto.drawdownBefore, d),
    drawdownAfter: toDisplay(dto.drawdownAfter, d),
  };
}

export function convertPulseMine(dto: PulseMyTradesDto, d: Display): PulseMyTradesDto {
  if (isIdentity(d)) return dto;
  return {
    ...dto,
    groups: dto.groups.map((g) => ({
      ...g,
      netPnl: money(g.netPnl, d.rate),
      avgPnl: g.avgPnl === null ? null : money(g.avgPnl, d.rate),
    })),
  };
}
