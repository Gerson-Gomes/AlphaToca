-- LL-018: Visit.source distinguishes manual-human agenda entries (MANUAL) from
-- AI-agent scheduled visits (AI). Existing rows default to MANUAL — the AI
-- branch has no writer yet (leadExtractionService detects intent but does not
-- create Visit rows directly).

-- CreateEnum
CREATE TYPE "VisitSource" AS ENUM ('MANUAL', 'AI');

-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "source" "VisitSource" NOT NULL DEFAULT 'MANUAL';
