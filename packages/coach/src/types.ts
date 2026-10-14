/** One closed trade as the coach sees it: numbers plus the trader's own journal, if any. */
export interface CoachTrade {
  id: string;
  sourceKey: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  openedAt: Date;
  closedAt: Date;
  /** Decimal string in the settlement currency. */
  netPnl: string;
  fees: string | null;
  entryPrice: string | null;
  exitPrice: string | null;
  quantity: string | null;
  leverage: string | null;
  holdingSeconds: number | null;
  settleAsset: string;
  quoteAsset: string;
  journal: CoachJournal | null;
  /** Net result divided by planned risk (from the journal stop); null when unknown. */
  rMultiple: number | null;
  plannedRewardRisk: number | null;
  /** Followed one of the trader's setup alerts. */
  planned?: boolean;
  /** Coin's 24h correlation to BTC at entry (Market Pulse). */
  btcCorr?: number | null;
}

export interface CoachJournal {
  rating: number | null;
  setup: string | null;
  mistakes: readonly string[];
  emotions: readonly string[];
  notes: string | null;
  stopPrice: string | null;
  targetPrice: string | null;
}
