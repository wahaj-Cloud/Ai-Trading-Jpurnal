-- Paper-trading bots (virtual money, never sends orders) and one-tap trade plans on scalp alerts.
ALTER TABLE "scalp_alerts" ADD COLUMN "plan_stop_ranges" REAL NOT NULL DEFAULT 1.5,
ADD COLUMN "plan_target_r" REAL NOT NULL DEFAULT 2,
ADD COLUMN "plan_risk_usd" DECIMAL(14,2);

CREATE TABLE "paper_bots" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "symbol" VARCHAR(30) NOT NULL,
    "source" VARCHAR(8) NOT NULL,
    "tf" VARCHAR(4) NOT NULL,
    "setup_id" UUID,
    "direction" VARCHAR(4) NOT NULL DEFAULT 'ANY',
    "min_count" SMALLINT NOT NULL DEFAULT 7,
    "no_news" BOOLEAN NOT NULL DEFAULT true,
    "stop_ranges" REAL NOT NULL DEFAULT 1.5,
    "target_r" REAL NOT NULL DEFAULT 2,
    "max_hold_min" INTEGER NOT NULL DEFAULT 60,
    "risk_pct" REAL NOT NULL DEFAULT 1,
    "fee_bps" REAL NOT NULL DEFAULT 5,
    "slippage_bps" REAL NOT NULL DEFAULT 2,
    "start_equity" DOUBLE PRECISION NOT NULL DEFAULT 10000,
    "equity" DOUBLE PRECISION NOT NULL DEFAULT 10000,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_met" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_bots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "paper_trades" (
    "id" UUID NOT NULL,
    "bot_id" UUID NOT NULL,
    "symbol" VARCHAR(30) NOT NULL,
    "side" "PositionDirection" NOT NULL,
    "entry_at" TIMESTAMPTZ(3) NOT NULL,
    "entry_price" DOUBLE PRECISION NOT NULL,
    "stop" DOUBLE PRECISION NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "risk_usd" DOUBLE PRECISION NOT NULL,
    "entry_note" JSONB,
    "exit_at" TIMESTAMPTZ(3),
    "exit_price" DOUBLE PRECISION,
    "exit_reason" VARCHAR(8),
    "fees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "funding" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pnl" DOUBLE PRECISION,
    "r_multiple" DOUBLE PRECISION,
    "funded_until" TIMESTAMPTZ(3),
    "status" VARCHAR(6) NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "paper_trades_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "paper_bots_user_id_idx" ON "paper_bots"("user_id");
CREATE INDEX "paper_bots_enabled_idx" ON "paper_bots"("enabled");
CREATE INDEX "paper_trades_bot_id_entry_at_idx" ON "paper_trades"("bot_id", "entry_at");
CREATE INDEX "paper_trades_status_idx" ON "paper_trades"("status");

ALTER TABLE "paper_bots" ADD CONSTRAINT "paper_bots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "paper_bots" ADD CONSTRAINT "paper_bots_setup_id_fkey" FOREIGN KEY ("setup_id") REFERENCES "setups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "paper_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
