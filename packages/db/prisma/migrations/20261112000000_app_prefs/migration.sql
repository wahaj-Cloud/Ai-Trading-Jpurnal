-- App preferences (start page, default Order Flow timeframe, reduced motion, trading defaults).
ALTER TABLE "user_settings" ADD COLUMN "app_prefs" JSONB NOT NULL DEFAULT '{}';
