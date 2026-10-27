ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "negotiation_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "negotiation_max_discount_percent" INTEGER;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "negotiation_state" JSONB;
