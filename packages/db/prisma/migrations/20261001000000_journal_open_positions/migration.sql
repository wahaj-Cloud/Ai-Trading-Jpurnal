-- CreateEnum
CREATE TYPE "MarginMode" AS ENUM ('CROSS', 'ISOLATED');

-- AlterTable: add, backfill, then require. Inverse ("USD"-quoted, coin-margined) contracts settle in
-- the base coin; everything else settles in its quote currency.
ALTER TABLE "positions" ADD COLUMN "settle_asset" TEXT;
UPDATE "positions"
   SET "settle_asset" = CASE WHEN "quote_asset" = 'USD' THEN "base_asset" ELSE "quote_asset" END;
ALTER TABLE "positions" ALTER COLUMN "settle_asset" SET NOT NULL;

-- CreateTable
CREATE TABLE "open_positions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "exchange" "Exchange" NOT NULL,
    "external_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "base_asset" TEXT NOT NULL,
    "quote_asset" TEXT NOT NULL,
    "settle_asset" TEXT NOT NULL,
    "direction" "PositionDirection" NOT NULL,
    "quantity" DECIMAL(36,18),
    "entry_price" DECIMAL(36,18),
    "mark_price" DECIMAL(36,18),
    "unrealized_pnl" DECIMAL(36,18),
    "leverage" DECIMAL(10,2),
    "liquidation_price" DECIMAL(36,18),
    "margin_mode" "MarginMode",
    "opened_at" TIMESTAMPTZ(3),
    "synced_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "open_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID,
    "position_key" TEXT NOT NULL,
    "setup" VARCHAR(80),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "emotions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mistakes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rating" SMALLINT,
    "notes" TEXT,
    "stop_price" DECIMAL(36,18),
    "target_price" DECIMAL(36,18),
    "screenshot_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "open_positions_user_id_idx" ON "open_positions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "open_positions_account_id_external_id_key" ON "open_positions"("account_id", "external_id");

-- CreateIndex
CREATE INDEX "journal_entries_tags_idx" ON "journal_entries" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "journal_entries_account_id_idx" ON "journal_entries"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_user_id_position_key_key" ON "journal_entries"("user_id", "position_key");

-- AddForeignKey
ALTER TABLE "open_positions" ADD CONSTRAINT "open_positions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_positions" ADD CONSTRAINT "open_positions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "exchange_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "exchange_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
