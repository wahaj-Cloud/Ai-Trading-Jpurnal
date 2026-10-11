-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'DONE', 'FAILED', 'LIMIT_REACHED');

-- CreateEnum
CREATE TYPE "CoachNoteKind" AS ENUM ('DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "CoachRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "trade_reviews" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID,
    "position_key" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "grade" VARCHAR(2) NOT NULL,
    "score" SMALLINT NOT NULL,
    "grade_factors" JSONB NOT NULL DEFAULT '[]',
    "flags" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "entry_analysis" TEXT,
    "exit_analysis" TEXT,
    "risk_analysis" TEXT,
    "strategy_analysis" TEXT,
    "mistakes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "positives" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "next_time" TEXT,
    "input_hash" TEXT NOT NULL,
    "model" TEXT,
    "prompt_version" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "generated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trade_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_notes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "CoachNoteKind" NOT NULL,
    "period" VARCHAR(10) NOT NULL,
    "content" JSONB NOT NULL,
    "flags" JSONB NOT NULL DEFAULT '[]',
    "stats" JSONB NOT NULL,
    "model" TEXT,
    "prompt_version" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "coach_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "CoachRole" NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trade_reviews_user_id_generated_at_idx" ON "trade_reviews"("user_id", "generated_at" DESC);

-- CreateIndex
CREATE INDEX "trade_reviews_account_id_idx" ON "trade_reviews"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "trade_reviews_user_id_position_key_key" ON "trade_reviews"("user_id", "position_key");

-- CreateIndex
CREATE INDEX "coach_notes_user_id_created_at_idx" ON "coach_notes"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "coach_notes_user_id_kind_period_key" ON "coach_notes"("user_id", "kind", "period");

-- CreateIndex
CREATE INDEX "coach_conversations_user_id_updated_at_idx" ON "coach_conversations"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "coach_messages_conversation_id_created_at_idx" ON "coach_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "trade_reviews" ADD CONSTRAINT "trade_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_reviews" ADD CONSTRAINT "trade_reviews_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "exchange_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_conversations" ADD CONSTRAINT "coach_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "coach_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
