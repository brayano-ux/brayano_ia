ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "ad_only_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "started_from_ad" BOOLEAN NOT NULL DEFAULT false;
