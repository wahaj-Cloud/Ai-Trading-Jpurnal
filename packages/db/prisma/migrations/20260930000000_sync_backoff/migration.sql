-- AlterTable
ALTER TABLE "exchange_accounts" ADD COLUMN     "sync_failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sync_retry_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "exchange_accounts_status_last_synced_at_idx" ON "exchange_accounts"("status", "last_synced_at");
