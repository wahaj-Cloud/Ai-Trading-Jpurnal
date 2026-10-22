-- Supply/demand zones: alerts, per-timeframe history, and the zone a trade was entered at.
ALTER TABLE "positions" ADD COLUMN "entry_zone" JSONB;

CREATE TABLE "zone_alerts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "symbol" VARCHAR(30) NOT NULL,
    "tfs" TEXT[],
    "side" VARCHAR(6) NOT NULL DEFAULT 'ANY',
    "fresh_only" BOOLEAN NOT NULL DEFAULT true,
    "cooldown_min" SMALLINT NOT NULL DEFAULT 120,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_zone_key" VARCHAR(60),
    "last_fired_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "zone_alerts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "zone_alerts_user_id_idx" ON "zone_alerts"("user_id");
CREATE INDEX "zone_alerts_enabled_idx" ON "zone_alerts"("enabled");
ALTER TABLE "zone_alerts" ADD CONSTRAINT "zone_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "zone_history" (
    "symbol" VARCHAR(30) NOT NULL,
    "tf" VARCHAR(4) NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "zones" JSONB NOT NULL,
    CONSTRAINT "zone_history_pkey" PRIMARY KEY ("symbol","tf","at")
);
CREATE INDEX "zone_history_at_idx" ON "zone_history"("at");
