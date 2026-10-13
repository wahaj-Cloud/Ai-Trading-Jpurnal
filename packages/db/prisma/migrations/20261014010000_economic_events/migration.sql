-- CreateTable
CREATE TABLE "economic_events" (
    "id" VARCHAR(64) NOT NULL,
    "title" TEXT NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "impact" VARCHAR(8) NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "tentative" BOOLEAN NOT NULL DEFAULT false,
    "actual" TEXT,
    "forecast" TEXT,
    "previous" TEXT,
    "source" VARCHAR(32) NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "economic_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "economic_events_starts_at_idx" ON "economic_events"("starts_at");
