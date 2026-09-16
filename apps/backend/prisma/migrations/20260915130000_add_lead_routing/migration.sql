DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProspectLeadStatus') THEN
    CREATE TYPE "ProspectLeadStatus" AS ENUM ('NEW', 'QUALIFYING', 'QUALIFIED', 'ROUTED', 'CONTACTED', 'CONVERTED', 'LOST');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProspectConsentStatus') THEN
    CREATE TYPE "ProspectConsentStatus" AS ENUM ('UNKNOWN', 'GRANTED', 'REFUSED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProspectRoutingStatus') THEN
    CREATE TYPE "ProspectRoutingStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "locations" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "recipient_whatsapp" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "responsibles" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "location_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "whatsapp_number" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "responsibles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "organization_routing_settings" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "fallback_responsible_id" TEXT,
  "fallback_whatsapp" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organization_routing_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "prospect_leads" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "conversation_id" TEXT,
  "location_id" TEXT,
  "responsible_id" TEXT,
  "contact_name" TEXT,
  "whatsapp_number" TEXT NOT NULL,
  "city" TEXT,
  "need" TEXT,
  "budget" TEXT,
  "product" TEXT,
  "urgency" TEXT,
  "status" "ProspectLeadStatus" NOT NULL DEFAULT 'NEW',
  "consent_status" "ProspectConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
  "route_status" "ProspectRoutingStatus" NOT NULL DEFAULT 'PENDING',
  "routed_at" TIMESTAMP(3),
  "is_routed" BOOLEAN NOT NULL DEFAULT false,
  "lead_score" INTEGER NOT NULL DEFAULT 0,
  "lead_data" JSONB,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "prospect_leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "organization_routing_settings_organization_id_key" ON "organization_routing_settings"("organization_id");
CREATE INDEX IF NOT EXISTS "locations_organization_id_idx" ON "locations"("organization_id");
CREATE INDEX IF NOT EXISTS "locations_organization_id_city_idx" ON "locations"("organization_id", "city");
CREATE INDEX IF NOT EXISTS "responsibles_organization_id_idx" ON "responsibles"("organization_id");
CREATE INDEX IF NOT EXISTS "responsibles_location_id_idx" ON "responsibles"("location_id");
CREATE INDEX IF NOT EXISTS "prospect_leads_organization_id_idx" ON "prospect_leads"("organization_id");
CREATE INDEX IF NOT EXISTS "prospect_leads_whatsapp_number_idx" ON "prospect_leads"("whatsapp_number");
CREATE INDEX IF NOT EXISTS "prospect_leads_organization_id_status_idx" ON "prospect_leads"("organization_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locations_organization_id_fkey') THEN
    ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'responsibles_organization_id_fkey') THEN
    ALTER TABLE "responsibles" ADD CONSTRAINT "responsibles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'responsibles_location_id_fkey') THEN
    ALTER TABLE "responsibles" ADD CONSTRAINT "responsibles_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_routing_settings_organization_id_fkey') THEN
    ALTER TABLE "organization_routing_settings" ADD CONSTRAINT "organization_routing_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_routing_settings_fallback_responsible_id_fkey') THEN
    ALTER TABLE "organization_routing_settings" ADD CONSTRAINT "organization_routing_settings_fallback_responsible_id_fkey" FOREIGN KEY ("fallback_responsible_id") REFERENCES "responsibles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_leads_organization_id_fkey') THEN
    ALTER TABLE "prospect_leads" ADD CONSTRAINT "prospect_leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_leads_conversation_id_fkey') THEN
    ALTER TABLE "prospect_leads" ADD CONSTRAINT "prospect_leads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_leads_location_id_fkey') THEN
    ALTER TABLE "prospect_leads" ADD CONSTRAINT "prospect_leads_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_leads_responsible_id_fkey') THEN
    ALTER TABLE "prospect_leads" ADD CONSTRAINT "prospect_leads_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "responsibles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
