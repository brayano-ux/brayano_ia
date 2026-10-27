ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "shop_latitude" DOUBLE PRECISION;
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "shop_longitude" DOUBLE PRECISION;
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "shop_location_label" TEXT;
