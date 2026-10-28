CREATE TABLE IF NOT EXISTS "sent_product_images" (
    "whatsapp_message_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sent_product_images_pkey" PRIMARY KEY ("whatsapp_message_id")
);

CREATE INDEX IF NOT EXISTS "sent_product_images_conversation_id_idx" ON "sent_product_images"("conversation_id");

DO $$ BEGIN
    ALTER TABLE "sent_product_images" ADD CONSTRAINT "sent_product_images_conversation_id_fkey"
        FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
