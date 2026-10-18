-- MetaTrader (Exness) sizes in lots, as MT4/MT5 show them.
ALTER TABLE "positions" ADD COLUMN "lots" DECIMAL(20,4);
ALTER TABLE "open_positions" ADD COLUMN "lots" DECIMAL(20,4);

-- Backfill closed Exness trades from their stored MT5 deals: the opening deals' volume (or the
-- closing deals' when the opening is outside the downloaded history). Journal keys are
-- "<account id>|X:P:<MT5 position id>". Open positions refresh with the next sync.
UPDATE "positions" p
SET "lots" = s."lots"
FROM (
  SELECT ep."account_id",
         ep."raw"->'deal'->>'positionId' AS "pid",
         COALESCE(
           NULLIF(SUM(CASE WHEN ep."raw"->'deal'->>'entryType' = 'DEAL_ENTRY_IN'
                           THEN (ep."raw"->'deal'->>'volume')::numeric ELSE 0 END), 0),
           SUM(CASE WHEN ep."raw"->'deal'->>'entryType' <> 'DEAL_ENTRY_IN'
                    THEN (ep."raw"->'deal'->>'volume')::numeric ELSE 0 END)
         ) AS "lots"
  FROM "exchange_positions" ep
  JOIN "exchange_accounts" a ON a."id" = ep."account_id"
  WHERE a."exchange" = 'EXNESS'
    AND ep."raw"->'deal'->>'positionId' IS NOT NULL
    AND ep."raw"->'deal'->>'volume' ~ '^[0-9.]+$'
  GROUP BY 1, 2
) s
WHERE p."account_id" = s."account_id"
  AND p."source_key" = s."account_id"::text || '|X:P:' || s."pid";

-- Market overview from CoinMarketCap.
CREATE TABLE "market_snapshots" (
    "key" VARCHAR(40) NOT NULL,
    "data" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "market_snapshots_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "market_cap_points" (
    "ts" TIMESTAMPTZ(3) NOT NULL,
    "total_market_cap" DECIMAL(30,2) NOT NULL,

    CONSTRAINT "market_cap_points_pkey" PRIMARY KEY ("ts")
);
