-- My Setup Alerts, What-If Lab, Strategy Lab and Market Pulse.

-- AlterTable
ALTER TABLE "positions" ADD COLUMN "setup_alert_id" UUID;
ALTER TABLE "positions" ADD COLUMN "btc_corr_at_entry" REAL;
ALTER TABLE "positions" ADD COLUMN "btc_beta_at_entry" REAL;

-- CreateTable
CREATE TABLE "setups" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "exchange" "Exchange" NOT NULL,
    "symbols" TEXT[],
    "timeframe" VARCHAR(4) NOT NULL,
    "rule" JSONB NOT NULL,
    "rule_version" SMALLINT NOT NULL,
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 60,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "setups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setup_alerts" (
    "id" UUID NOT NULL,
    "setup_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "symbol" VARCHAR(30) NOT NULL,
    "timeframe" VARCHAR(4) NOT NULL,
    "direction" VARCHAR(5) NOT NULL,
    "candle_close_at" TIMESTAMPTZ(3) NOT NULL,
    "matched" JSONB NOT NULL,
    "channels" TEXT[],
    "dismissed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "setup_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "what_if_scenarios" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "filters" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "what_if_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "setup_id" UUID,
    "setup_name" VARCHAR(60) NOT NULL,
    "rule" JSONB NOT NULL,
    "exchange" "Exchange" NOT NULL,
    "timeframe" VARCHAR(4) NOT NULL,
    "symbols" TEXT[],
    "exit_model" JSONB NOT NULL,
    "from_day" DATE NOT NULL,
    "to_day" DATE NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'QUEUED',
    "progress" REAL NOT NULL DEFAULT 0,
    "summary" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "backtest_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_trades" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "symbol" VARCHAR(30) NOT NULL,
    "side" "PositionDirection" NOT NULL,
    "entry_at" TIMESTAMPTZ(3) NOT NULL,
    "entry_price" DOUBLE PRECISION NOT NULL,
    "exit_at" TIMESTAMPTZ(3) NOT NULL,
    "exit_price" DOUBLE PRECISION NOT NULL,
    "exit_reason" VARCHAR(8) NOT NULL,
    "r_multiple" DOUBLE PRECISION NOT NULL,
    "pnl" DOUBLE PRECISION NOT NULL,
    "fees" DOUBLE PRECISION NOT NULL,
    "funding" DOUBLE PRECISION NOT NULL,
    "flags" TEXT[],

    CONSTRAINT "backtest_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_candles" (
    "exchange" "Exchange" NOT NULL,
    "symbol" VARCHAR(30) NOT NULL,
    "timeframe" VARCHAR(4) NOT NULL,
    "open_time" TIMESTAMPTZ(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "market_candles_pkey" PRIMARY KEY ("exchange","symbol","timeframe","open_time")
);

-- CreateTable
CREATE TABLE "funding_rates" (
    "exchange" "Exchange" NOT NULL,
    "symbol" VARCHAR(30) NOT NULL,
    "funding_time" TIMESTAMPTZ(3) NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "funding_rates_pkey" PRIMARY KEY ("exchange","symbol","funding_time")
);

-- CreateTable
CREATE TABLE "market_correlation_latest" (
    "symbol" VARCHAR(30) NOT NULL,
    "window" VARCHAR(4) NOT NULL,
    "rank" INTEGER NOT NULL,
    "quote_volume" DECIMAL(24,2) NOT NULL,
    "corr" DOUBLE PRECISION NOT NULL,
    "beta" DOUBLE PRECISION NOT NULL,
    "rel_strength" DOUBLE PRECISION NOT NULL,
    "coin_return" DOUBLE PRECISION NOT NULL,
    "btc_return" DOUBLE PRECISION NOT NULL,
    "points" INTEGER NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "market_correlation_latest_pkey" PRIMARY KEY ("symbol","window")
);

-- CreateTable
CREATE TABLE "market_correlation_hourly" (
    "symbol" VARCHAR(30) NOT NULL,
    "hour" TIMESTAMPTZ(3) NOT NULL,
    "corr" DOUBLE PRECISION NOT NULL,
    "beta" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "market_correlation_hourly_pkey" PRIMARY KEY ("symbol","hour")
);

-- CreateIndex
CREATE INDEX "setups_user_id_created_at_idx" ON "setups"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "setups_is_active_exchange_timeframe_idx" ON "setups"("is_active", "exchange", "timeframe");

-- CreateIndex
CREATE INDEX "setup_alerts_user_id_created_at_idx" ON "setup_alerts"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "setup_alerts_user_id_symbol_candle_close_at_idx" ON "setup_alerts"("user_id", "symbol", "candle_close_at");

-- CreateIndex
CREATE UNIQUE INDEX "setup_alerts_setup_id_symbol_candle_close_at_key" ON "setup_alerts"("setup_id", "symbol", "candle_close_at");

-- CreateIndex
CREATE INDEX "what_if_scenarios_user_id_idx" ON "what_if_scenarios"("user_id");

-- CreateIndex
CREATE INDEX "backtest_runs_user_id_created_at_idx" ON "backtest_runs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "backtest_runs_status_idx" ON "backtest_runs"("status");

-- CreateIndex
CREATE INDEX "backtest_trades_run_id_entry_at_idx" ON "backtest_trades"("run_id", "entry_at");

-- CreateIndex
CREATE INDEX "market_correlation_latest_window_rank_idx" ON "market_correlation_latest"("window", "rank");

-- CreateIndex
CREATE INDEX "market_correlation_hourly_hour_idx" ON "market_correlation_hourly"("hour");

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_setup_alert_id_fkey" FOREIGN KEY ("setup_alert_id") REFERENCES "setup_alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setups" ADD CONSTRAINT "setups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_alerts" ADD CONSTRAINT "setup_alerts_setup_id_fkey" FOREIGN KEY ("setup_id") REFERENCES "setups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_alerts" ADD CONSTRAINT "setup_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "what_if_scenarios" ADD CONSTRAINT "what_if_scenarios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_setup_id_fkey" FOREIGN KEY ("setup_id") REFERENCES "setups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "backtest_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
