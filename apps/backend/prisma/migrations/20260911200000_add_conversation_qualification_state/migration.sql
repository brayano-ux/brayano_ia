-- Add the backend-owned qualification and handoff state.
ALTER TYPE "ConversationStatus" ADD VALUE IF NOT EXISTS 'HUMAN_HANDOFF';

CREATE TYPE "QualificationStatus" AS ENUM ('NOT_QUALIFIED', 'QUALIFYING', 'QUALIFIED');

ALTER TABLE "conversations"
  ADD COLUMN "qualification_status" "QualificationStatus" NOT NULL DEFAULT 'NOT_QUALIFIED',
  ADD COLUMN "lead_score" INTEGER,
  ADD COLUMN "lead_data" JSONB;
