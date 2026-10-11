import "server-only";
import type { ExchangeAccountsResponse } from "@atc/shared";
import { cache } from "react";
import { apiFetch } from "@/lib/api";

export const getExchangeAccounts = cache(() =>
  apiFetch<ExchangeAccountsResponse>("/v1/exchange-accounts"),
);
