-- CreateEnum
CREATE TYPE "Exchange" AS ENUM ('BINANCE', 'MEXC');

-- CreateEnum
CREATE TYPE "ExchangeAccountStatus" AS ENUM ('ACTIVE', 'INVALID', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "exchange_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "exchange" "Exchange" NOT NULL,
    "label" TEXT NOT NULL,
    "status" "ExchangeAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "external_account_id" TEXT,
    "api_key_hint" TEXT NOT NULL,
    "ip_restricted" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "last_verified_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exchange_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_credentials" (
    "account_id" UUID NOT NULL,
    "key_id" TEXT NOT NULL,
    "wrapped_data_key" BYTEA NOT NULL,
    "api_key_cipher" BYTEA NOT NULL,
    "api_secret_cipher" BYTEA NOT NULL,
    "passphrase_cipher" BYTEA,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_at" TIMESTAMPTZ(3),

    CONSTRAINT "exchange_credentials_pkey" PRIMARY KEY ("account_id")
);

-- CreateIndex
CREATE INDEX "exchange_accounts_user_id_status_idx" ON "exchange_accounts"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_accounts_user_id_exchange_external_account_id_key" ON "exchange_accounts"("user_id", "exchange", "external_account_id");

-- CreateIndex
CREATE INDEX "exchange_credentials_key_id_idx" ON "exchange_credentials"("key_id");

-- AddForeignKey
ALTER TABLE "exchange_accounts" ADD CONSTRAINT "exchange_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_credentials" ADD CONSTRAINT "exchange_credentials_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "exchange_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
