-- Where a released figure came from and when we received it (to compare source speed).
ALTER TABLE "economic_events" ADD COLUMN "actual_source" VARCHAR(32);
ALTER TABLE "economic_events" ADD COLUMN "actual_at" TIMESTAMPTZ(3);
