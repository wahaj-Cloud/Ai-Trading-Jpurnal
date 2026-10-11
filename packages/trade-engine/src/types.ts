export type Side = "BUY" | "SELL";
/** BOTH = one-way mode (net position); LONG/SHORT = hedge mode tracks. */
export type PositionSide = "LONG" | "SHORT" | "BOTH";
export type Direction = "LONG" | "SHORT";

/** One execution, normalised across exchanges: linear contracts, quantity in base units. */
export interface EngineFill {
  id: string;
  symbol: string;
  side: Side;
  positionSide: PositionSide;
  price: string;
  /** Always positive, in base units (contracts already multiplied by contract size). */
  qty: string;
  /** Fee paid in the quote currency; negative for rebates. */
  fee: string;
  /** Gross realised PnL the exchange attributed to this fill, if it reports one. */
  realizedPnl: string | null;
  executedAt: Date;
}

export interface FillAllocation {
  fillId: string;
  /** Portion of the fill that belongs to this position (a flip splits one fill in two). */
  qty: string;
  role: "OPEN" | "CLOSE";
}

/** The journal's unit: one round trip on one symbol and direction. */
export interface DerivedPosition {
  /** Stable identity across re-syncs, so rebuilding history updates rows instead of duplicating. */
  sourceKey: string;
  symbol: string;
  direction: Direction;
  status: "OPEN" | "CLOSED";
  openedAt: Date;
  closedAt: Date | null;
  /** null when the exchange did not report it (and it cannot be derived). */
  entryPrice: string | null;
  exitPrice: string | null;
  /** Largest size held, in base units. */
  quantity: string | null;
  leverage: string | null;
  grossPnl: string | null;
  /** Positive = paid. */
  fees: string | null;
  /** Positive = received, negative = paid. */
  funding: string | null;
  netPnl: string | null;
  /** True when the position opened before the history we could download. */
  incompleteHistory: boolean;
  /**
   * Currency PnL is paid in, when the venue states it (MetaTrader: the account currency).
   * Otherwise it follows from the symbol.
   */
  settleAsset?: string;
}

export interface ReconstructedPosition extends DerivedPosition {
  positionSide: PositionSide;
  /** Size still open, in base units (0 when closed). */
  openQuantity: string;
  allocations: FillAllocation[];
}
