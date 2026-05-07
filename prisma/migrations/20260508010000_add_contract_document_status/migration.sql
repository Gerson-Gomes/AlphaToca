-- LL-016: Contract.documentStatus tracks the documental lifecycle of the rental
-- (PENDING_DOCUMENTS → AWAITING_SIGNATURE → APPROVED), independent of Contract.status.
-- Backfills APPROVED when signed_at is already set — those contracts clearly have
-- an approved/signed PDF attached via PUT /api/contracts/:id/signed-document (US-016).

-- CreateEnum
CREATE TYPE "ContractDocumentStatus" AS ENUM ('PENDING_DOCUMENTS', 'AWAITING_SIGNATURE', 'APPROVED');

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "document_status" "ContractDocumentStatus" NOT NULL DEFAULT 'PENDING_DOCUMENTS';

-- Backfill APPROVED for contracts that already have a signed PDF attached.
UPDATE "contracts" SET "document_status" = 'APPROVED' WHERE "signed_at" IS NOT NULL;
