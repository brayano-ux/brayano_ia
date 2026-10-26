ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "topic_gate_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "topic_gate_topic" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "topic_gate_opened" BOOLEAN NOT NULL DEFAULT false;
