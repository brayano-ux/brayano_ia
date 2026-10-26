CREATE TABLE IF NOT EXISTS "landing_page_views" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "visitor_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "landing_page_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "landing_page_views_day_idx" ON "landing_page_views"("day");
CREATE INDEX IF NOT EXISTS "landing_page_views_day_visitor_hash_idx" ON "landing_page_views"("day", "visitor_hash");
