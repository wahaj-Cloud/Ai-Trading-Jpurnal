-- AlterEnum
ALTER TYPE "Exchange" ADD VALUE 'KUCOIN';
ALTER TYPE "Exchange" ADD VALUE 'BINGX';

-- AlterTable: some exchanges do not report IP restrictions, so "unknown" (NULL) is a real state.
ALTER TABLE "exchange_accounts" ALTER COLUMN "ip_restricted" DROP NOT NULL,
ALTER COLUMN "ip_restricted" DROP DEFAULT,
ADD COLUMN "key_expires_at" TIMESTAMPTZ(3);
