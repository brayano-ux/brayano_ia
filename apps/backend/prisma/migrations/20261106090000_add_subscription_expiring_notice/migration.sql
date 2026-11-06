ALTER TABLE "billing_subscriptions" ADD COLUMN IF NOT EXISTS "expiring_notice_sent_at" TIMESTAMP(3);
