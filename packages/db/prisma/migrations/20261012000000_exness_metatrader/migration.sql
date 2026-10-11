-- AlterEnum
ALTER TYPE "Exchange" ADD VALUE 'EXNESS';

-- AlterEnum
ALTER TYPE "ExchangeAccountStatus" ADD VALUE 'CONNECTING';

-- AlterTable
ALTER TABLE "exchange_accounts" ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}';
