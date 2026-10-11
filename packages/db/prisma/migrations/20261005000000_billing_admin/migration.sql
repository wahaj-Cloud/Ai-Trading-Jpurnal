-- CreateEnum
CREATE TYPE "AnnouncementLevel" AS ENUM ('INFO', 'WARNING');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "manual_plan" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paddle_event_at" TIMESTAMPTZ(3),
ADD COLUMN     "paddle_price_id" TEXT;

-- CreateTable
CREATE TABLE "billing_events" (
    "id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" UUID,
    "payload" JSONB NOT NULL,
    "outcome" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "level" "AnnouncementLevel" NOT NULL DEFAULT 'INFO',
    "starts_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_events_event_id_key" ON "billing_events"("event_id");

-- CreateIndex
CREATE INDEX "billing_events_user_id_created_at_idx" ON "billing_events"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "billing_events_created_at_idx" ON "billing_events"("created_at" DESC);

-- CreateIndex
CREATE INDEX "announcements_starts_at_ends_at_idx" ON "announcements"("starts_at", "ends_at");
