-- AlterEnum: Bybit and OKX trade sync.
ALTER TYPE "Exchange" ADD VALUE 'BYBIT';
ALTER TYPE "Exchange" ADD VALUE 'OKX';

-- Estimated liquidation map per market and window (latest only).
CREATE TABLE "liquidation_maps" (
    "symbol" VARCHAR(30) NOT NULL,
    "window" VARCHAR(4) NOT NULL,
    "data" JSONB NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "liquidation_maps_pkey" PRIMARY KEY ("symbol","window")
);

-- Plan limit: Pro and Premium map every market; Free keeps the Bitcoin preview.
-- Only fills the key when missing, so a value an admin already set is kept.
UPDATE "plans" SET "limits" = jsonb_build_object('liquidationMap', 0) || "limits"::jsonb WHERE "code" = 'FREE';
UPDATE "plans" SET "limits" = jsonb_build_object('liquidationMap', 1) || "limits"::jsonb WHERE "code" IN ('PRO', 'PREMIUM', 'ENTERPRISE');
