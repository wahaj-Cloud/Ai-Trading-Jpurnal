-- Scalp Cockpit: alerts, per-minute readings (kept 8 days) and the readings at each trade's entry.
CREATE TABLE "scalp_alerts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "symbol" VARCHAR(30) NOT NULL,
    "tf" VARCHAR(4) NOT NULL,
    "direction" VARCHAR(4) NOT NULL,
    "min_count" SMALLINT NOT NULL,
    "no_news" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cooldown_min" SMALLINT NOT NULL DEFAULT 30,
    "last_met" BOOLEAN NOT NULL DEFAULT false,
    "last_fired_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scalp_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scalp_alerts_user_id_idx" ON "scalp_alerts"("user_id");
CREATE INDEX "scalp_alerts_enabled_idx" ON "scalp_alerts"("enabled");

ALTER TABLE "scalp_alerts" ADD CONSTRAINT "scalp_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "scalp_readouts" (
    "at" TIMESTAMPTZ(3) NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "scalp_readouts_pkey" PRIMARY KEY ("at")
);

ALTER TABLE "positions" ADD COLUMN "entry_readout" JSONB;
