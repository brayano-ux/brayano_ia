ALTER TABLE "organizations"
  ADD COLUMN "platform_suspended" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "suspension_reason" TEXT,
  ADD COLUMN "suspended_at" TIMESTAMP(3);
