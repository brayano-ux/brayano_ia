ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "agent_domain" TEXT;
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "agent_role" TEXT;
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "agent_tone" TEXT;
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "persona_prompted_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ignored_contacts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "whatsapp_number" TEXT NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ignored_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ignored_contacts_organization_id_whatsapp_number_key" ON "ignored_contacts"("organization_id", "whatsapp_number");
CREATE INDEX IF NOT EXISTS "ignored_contacts_organization_id_idx" ON "ignored_contacts"("organization_id");

DO $$ BEGIN
  ALTER TABLE "ignored_contacts" ADD CONSTRAINT "ignored_contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
