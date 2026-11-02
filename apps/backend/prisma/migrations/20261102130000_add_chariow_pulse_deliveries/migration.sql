CREATE TABLE IF NOT EXISTS "chariow_pulse_deliveries" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "pulse_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "chariow_pulse_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "chariow_pulse_deliveries_delivery_id_key" ON "chariow_pulse_deliveries"("delivery_id");

CREATE INDEX IF NOT EXISTS "chariow_pulse_deliveries_event_received_at_idx" ON "chariow_pulse_deliveries"("event", "received_at");
