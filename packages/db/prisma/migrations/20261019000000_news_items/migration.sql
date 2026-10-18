-- Market-moving headlines from Finnhub, Trading Economics, the Fed, the ECB and GDELT (kept 30 days).
CREATE TABLE "news_items" (
    "id" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "source_id" VARCHAR(200) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "summary" VARCHAR(2000),
    "url" VARCHAR(1000),
    "publisher" VARCHAR(120) NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "impact" VARCHAR(6) NOT NULL,
    "tags" TEXT[],
    "why" VARCHAR(400),
    "cluster_id" UUID,
    "reaction" JSONB,

    CONSTRAINT "news_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "news_items_source_source_id_key" ON "news_items"("source", "source_id");
CREATE INDEX "news_items_category_published_at_idx" ON "news_items"("category", "published_at" DESC);
CREATE INDEX "news_items_impact_published_at_idx" ON "news_items"("impact", "published_at" DESC);
CREATE INDEX "news_items_cluster_id_idx" ON "news_items"("cluster_id");
CREATE INDEX "news_items_published_at_idx" ON "news_items"("published_at");
