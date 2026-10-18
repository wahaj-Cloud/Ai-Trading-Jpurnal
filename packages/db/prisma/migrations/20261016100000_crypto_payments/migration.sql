-- Crypto payments (NOWPayments): prepaid periods without auto-renewal.
ALTER TABLE "subscriptions" ADD COLUMN "crypto_paid_until" TIMESTAMPTZ(3);

CREATE TABLE "crypto_payments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_code" "PlanCode" NOT NULL,
    "interval" VARCHAR(5) NOT NULL,
    "amount_usd" DECIMAL(10,2) NOT NULL,
    "invoice_id" VARCHAR(40),
    "payment_id" VARCHAR(40),
    "status" VARCHAR(12) NOT NULL DEFAULT 'CREATED',
    "pay_currency" VARCHAR(20),
    "paid_at" TIMESTAMPTZ(3),
    "period_end" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crypto_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crypto_payments_invoice_id_key" ON "crypto_payments"("invoice_id");
CREATE INDEX "crypto_payments_user_id_created_at_idx" ON "crypto_payments"("user_id", "created_at" DESC);

ALTER TABLE "crypto_payments" ADD CONSTRAINT "crypto_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
