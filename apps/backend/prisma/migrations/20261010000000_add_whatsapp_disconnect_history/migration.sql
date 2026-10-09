ALTER TABLE "whatsapp_accounts"
  ADD COLUMN "last_connected_at" TIMESTAMP(3),
  ADD COLUMN "last_disconnected_at" TIMESTAMP(3),
  ADD COLUMN "last_disconnect_reason" TEXT;
