-- Trade Check: trend bias and funding history, to match past trades with the conditions at entry.
CREATE TABLE "market_trend_history" (
    "symbol" VARCHAR(20) NOT NULL,
    "timeframe" VARCHAR(4) NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "state" VARCHAR(5) NOT NULL,

    CONSTRAINT "market_trend_history_pkey" PRIMARY KEY ("symbol","timeframe","at")
);

CREATE TABLE "funding_rate_history" (
    "symbol" VARCHAR(20) NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "rate" DECIMAL(14,10) NOT NULL,

    CONSTRAINT "funding_rate_history_pkey" PRIMARY KEY ("symbol","at")
);
