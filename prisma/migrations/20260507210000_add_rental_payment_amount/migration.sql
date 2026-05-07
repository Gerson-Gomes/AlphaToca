-- Best-effort backfill from currently-ACTIVE contract.monthlyRent — historical rent changes not preserved. See PRD §8 Q2.

-- AlterTable
ALTER TABLE "rental_payments" ADD COLUMN     "amount" DECIMAL(10,2);

-- Backfill: pick the property's currently-ACTIVE contract's monthly_rent for
-- any pre-existing rental_payments rows. Rows written after this migration
-- will have `amount` populated at upsert time by rentalPaymentService (LL-003).
UPDATE "rental_payments" rp
SET "amount" = (
    SELECT c."monthly_rent"
    FROM "contracts" c
    WHERE c."property_id" = rp."property_id"
      AND c."status" = 'ACTIVE'
    LIMIT 1
)
WHERE "amount" IS NULL;
