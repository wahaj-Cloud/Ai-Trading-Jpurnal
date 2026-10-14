-- New list prices (Free $0, Pro $15, Premium $25). Pro becomes 2 crypto exchange connections plus
-- 1 Exness (MetaTrader) account; Exness is now counted separately from crypto exchanges.
-- This is a deliberate pricing decision, so these values replace what was stored.
UPDATE "plans" SET "price_usd" = 0 WHERE "code" = 'FREE';
UPDATE "plans" SET "price_usd" = 15,
  "limits" = "limits"::jsonb || jsonb_build_object('exchangeAccounts', 2, 'brokerAccounts', 1)
  WHERE "code" = 'PRO';
UPDATE "plans" SET "price_usd" = 25 WHERE "code" = 'PREMIUM';
