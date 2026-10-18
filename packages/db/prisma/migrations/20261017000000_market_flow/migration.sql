-- Market Flow: whale trades and real liquidations from public exchange feeds (kept 8 days).
CREATE TABLE "whale_trades" (
    "id" BIGSERIAL NOT NULL,
    "exchange" "Exchange" NOT NULL,
    "symbol" VARCHAR(20) NOT NULL,
    "side" VARCHAR(4) NOT NULL,
    "price" DECIMAL(24,10) NOT NULL,
    "qty" DECIMAL(30,10) NOT NULL,
    "usd" DECIMAL(20,2) NOT NULL,
    "fills" INTEGER NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whale_trades_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "liquidation_events" (
    "id" BIGSERIAL NOT NULL,
    "exchange" "Exchange" NOT NULL,
    "symbol" VARCHAR(20) NOT NULL,
    "side" VARCHAR(5) NOT NULL,
    "price" DECIMAL(24,10) NOT NULL,
    "qty" DECIMAL(30,10) NOT NULL,
    "usd" DECIMAL(20,2) NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "liquidation_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "whale_trades_symbol_at_idx" ON "whale_trades"("symbol", "at" DESC);
CREATE INDEX "whale_trades_at_idx" ON "whale_trades"("at");
CREATE INDEX "liquidation_events_symbol_at_idx" ON "liquidation_events"("symbol", "at" DESC);
CREATE INDEX "liquidation_events_at_idx" ON "liquidation_events"("at");
