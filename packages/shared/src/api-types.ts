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
