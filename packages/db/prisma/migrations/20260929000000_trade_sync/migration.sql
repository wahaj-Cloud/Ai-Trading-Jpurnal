-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "PositionSide" AS ENUM ('LONG', 'SHORT', 'BOTH');

-- CreateEnum
CREATE TYPE "IncomeType" AS ENUM ('FUNDING', 'COMMISSION', 'REALIZED_PNL', 'OTHER');

-- CreateEnum
CREATE TYPE "PositionSource" AS ENUM ('FILLS', 'EXCHANGE', 'CSV');

-- CreateEnum
CREATE TYPE "PositionDirection" AS ENUM ('LONG', 'SHORT');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "FillRole" AS ENUM ('OPEN', 'CLOSE');

-- CreateEnum
CREATE TYPE "SyncRunKind" AS ENUM ('BACKFILL', 'INCREMENTAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "exchange_accounts" ADD COLUMN     "backfill_completed_at" TIMESTAMPTZ(3),
ADD COLUMN     "history_starts_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_synced_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "fills" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "exchange_fill_id" TEXT NOT NULL,
    "order_id" TEXT,
    "symbol" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "position_side" "PositionSide" NOT NULL,
    "price" DECIMAL(36,18) NOT NULL,
    "qty" DECIMAL(36,18) NOT NULL,
    "fee" DECIMAL(36,18) NOT NULL,
    "fee_asset" TEXT,
    "realized_pnl" DECIMAL(36,18),
    "is_maker" BOOLEAN,
    "executed_at" TIMESTAMPTZ(3) NOT NULL,
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income_events" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "type" "IncomeType" NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "asset" TEXT NOT NULL,
    "symbol" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "income_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_positions" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "closed" BOOLEAN NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "raw" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID,
    "exchange" "Exchange" NOT NULL,
    "source" "PositionSource" NOT NULL,
    "source_key" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "base_asset" TEXT NOT NULL,
    "quote_asset" TEXT NOT NULL,
    "direction" "PositionDirection" NOT NULL,
    "status" "PositionStatus" NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "entry_price" DECIMAL(36,18),
    "exit_price" DECIMAL(36,18),
    "quantity" DECIMAL(36,18),
    "leverage" DECIMAL(10,2),
    "gross_pnl" DECIMAL(36,18),
    "fees" DECIMAL(36,18),
    "funding" DECIMAL(36,18),
    "net_pnl" DECIMAL(36,18),
    "holding_seconds" INTEGER,
    "incomplete_history" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_fills" (
    "position_id" UUID NOT NULL,
    "fill_id" UUID NOT NULL,
    "qty" DECIMAL(36,18) NOT NULL,
    "role" "FillRole" NOT NULL,

    CONSTRAINT "position_fills_pkey" PRIMARY KEY ("position_id","fill_id")
);

-- CreateTable
CREATE TABLE "sync_cursors" (
    "account_id" UUID NOT NULL,
    "stream" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sync_cursors_pkey" PRIMARY KEY ("account_id","stream")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "kind" "SyncRunKind" NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "window_start" TIMESTAMPTZ(3),
    "window_end" TIMESTAMPTZ(3),
    "fills_fetched" INTEGER NOT NULL DEFAULT 0,
    "income_fetched" INTEGER NOT NULL DEFAULT 0,
    "positions_upserted" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fills_account_id_symbol_executed_at_idx" ON "fills"("account_id", "symbol", "executed_at");

-- CreateIndex
CREATE UNIQUE INDEX "fills_account_id_exchange_fill_id_key" ON "fills"("account_id", "exchange_fill_id");

-- CreateIndex
CREATE INDEX "income_events_account_id_type_occurred_at_idx" ON "income_events"("account_id", "type", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "income_events_account_id_external_id_key" ON "income_events"("account_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_positions_account_id_external_id_key" ON "exchange_positions"("account_id", "external_id");

-- CreateIndex
CREATE INDEX "positions_user_id_closed_at_idx" ON "positions"("user_id", "closed_at" DESC);

-- CreateIndex
CREATE INDEX "positions_user_id_status_idx" ON "positions"("user_id", "status");

-- CreateIndex
CREATE INDEX "positions_account_id_symbol_idx" ON "positions"("account_id", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "positions_user_id_source_key_key" ON "positions"("user_id", "source_key");

-- CreateIndex
CREATE INDEX "position_fills_fill_id_idx" ON "position_fills"("fill_id");

-- CreateIndex
CREATE INDEX "sync_runs_account_id_started_at_idx" ON "sync_runs"("account_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "sync_runs_status_started_at_idx" ON "sync_runs"("status", "started_at");

-- AddForeignKey
ALTER TABLE "fills" ADD CONSTRAINT "fills_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "exchange_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_events" ADD CONSTRAINT "income_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "exchange_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_positions" ADD CONSTRAINT "exchange_positions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "exchange_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "exchange_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_fills" ADD CONSTRAINT "position_fills_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_fills" ADD CONSTRAINT "position_fills_fill_id_fkey" FOREIGN KEY ("fill_id") REFERENCES "fills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "exchange_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "exchange_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
