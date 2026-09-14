ALTER TABLE "ai_settings"
  ADD COLUMN IF NOT EXISTS "response_delay_seconds" INTEGER NOT NULL DEFAULT 3;
