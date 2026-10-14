-- Founding-member badge and plan list prices (admin margin view).
ALTER TABLE "users" ADD COLUMN "founding_member" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "plans" ADD COLUMN "price_usd" DECIMAL(10,2);

-- Monthly AI budget (US$) and MetaTrader (Exness) connections per plan, sized for a 75%+ margin.
-- Only fills keys that are missing, so limits an admin already tuned are kept.
UPDATE "plans" SET "limits" = jsonb_build_object('aiBudgetUsd', 0.3, 'brokerAccounts', 0) || "limits"::jsonb
  WHERE "code" = 'FREE';
UPDATE "plans" SET "limits" = jsonb_build_object('aiBudgetUsd', 3, 'brokerAccounts', 0) || "limits"::jsonb
  WHERE "code" = 'PRO';
UPDATE "plans" SET "limits" = jsonb_build_object('aiBudgetUsd', 7, 'brokerAccounts', 2) || "limits"::jsonb
  WHERE "code" = 'PREMIUM';
UPDATE "plans" SET "limits" = jsonb_build_object('aiBudgetUsd', -1, 'brokerAccounts', -1) || "limits"::jsonb
  WHERE "code" = 'ENTERPRISE';
