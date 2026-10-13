-- AlterTable
ALTER TABLE "users" ADD COLUMN     "display_currency" TEXT NOT NULL DEFAULT 'USD';

-- CreateTable
CREATE TABLE "fx_rates" (
    "currency" VARCHAR(3) NOT NULL,
    "per_usd" DECIMAL(24,10) NOT NULL,
    "as_of" TIMESTAMPTZ(3) NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("currency")
);
