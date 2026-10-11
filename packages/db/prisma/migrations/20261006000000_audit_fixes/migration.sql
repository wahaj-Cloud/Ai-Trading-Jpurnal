-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "suspended_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "subscriptions_paddle_customer_id_idx" ON "subscriptions"("paddle_customer_id");

-- CreateIndex
CREATE INDEX "positions_closed_at_idx" ON "positions"("closed_at");

-- Data: admin suspensions used to be stored in deleted_at. Accounts whose personal data was not
-- scrubbed were suspended, not deleted: move them to suspended_at.
UPDATE "users"
   SET "suspended_at" = "deleted_at", "deleted_at" = NULL
 WHERE "deleted_at" IS NOT NULL AND "email" NOT LIKE 'deleted+%@users.invalid';

-- Data: deleted accounts never keep exchange keys.
DELETE FROM "exchange_credentials" c
 USING "exchange_accounts" a, "users" u
 WHERE c."account_id" = a."id" AND a."user_id" = u."id" AND u."deleted_at" IS NOT NULL;
UPDATE "exchange_accounts" a SET "status" = 'DISCONNECTED'
  FROM "users" u WHERE a."user_id" = u."id" AND u."deleted_at" IS NOT NULL;
