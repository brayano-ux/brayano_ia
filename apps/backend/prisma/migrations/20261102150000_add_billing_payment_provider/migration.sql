ALTER TABLE "billing_payments" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'campay';
