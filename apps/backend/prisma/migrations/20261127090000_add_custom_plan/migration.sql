ALTER TABLE "billing_subscriptions" ADD COLUMN IF NOT EXISTS "custom" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "billing_subscriptions" ADD COLUMN IF NOT EXISTS "custom_broadcasts" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "billing_subscriptions" ADD COLUMN IF NOT EXISTS "custom_follow_ups" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "billing_subscriptions" ADD COLUMN IF NOT EXISTS "custom_team_members" INTEGER NOT NULL DEFAULT 0;
