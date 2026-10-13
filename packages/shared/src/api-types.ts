// Contract between API and web. Changing a shape here is a breaking change for both apps.
import type { PlanLimits } from "./plans.js";

export type PlanCode = "FREE" | "PRO" | "PREMIUM" | "ENTERPRISE";

export interface MeResponse {
  id: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
  timezone: string;
  baseCurrency: string;
  /** ISO code every amount is shown in (converted from USD at the latest daily rate). */
  displayCurrency: string;
  role: "USER" | "ADMIN";
  settings: { pnlColorScheme: "standard" | "colorblind" };
  plan: { code: PlanCode; name: string; limits: PlanLimits; status: string };
  onboarding: {
    exchangeConnected: boolean;
    firstSyncCompleted: boolean;
    firstTradeReviewed: boolean;
  };
}

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  issues?: { path: string; message: string }[];
  requestId?: string;
}

/** Latest daily exchange rates: units of each currency per 1 US dollar. */
export interface FxRatesDto {
  base: "USD";
  /** When the provider last updated the rates (ISO time). */
  asOf: string;
  /** When we last fetched them. */
  fetchedAt: string;
  source: string;
  rates: Record<string, number>;
}
