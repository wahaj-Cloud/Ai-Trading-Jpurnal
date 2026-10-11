-- CreateEnum
CREATE TYPE "ContextStatus" AS ENUM ('DONE', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "trade_contexts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID,
    "position_key" TEXT NOT NULL,
    "status" "ContextStatus" NOT NULL,
    "timeframe" VARCHAR(4),
    "context" JSONB,
    "version" SMALLINT NOT NULL DEFAULT 1,
    "error" TEXT,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trade_contexts_account_id_idx" ON "trade_contexts"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "trade_contexts_user_id_position_key_key" ON "trade_contexts"("user_id", "position_key");

-- AddForeignKey
ALTER TABLE "trade_contexts" ADD CONSTRAINT "trade_contexts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_contexts" ADD CONSTRAINT "trade_contexts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "exchange_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
