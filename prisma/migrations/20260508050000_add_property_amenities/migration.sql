-- LL-021: Property amenities columns (hasWifi, hasPool)
-- Adds two boolean amenity flags to properties. Both default to false so
-- existing rows retain a safe "amenity absent" semantic without an explicit
-- backfill. Write-path support (POST/PUT) and search filters land in LL-022.

ALTER TABLE "properties" ADD COLUMN     "has_wifi" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "has_pool" BOOLEAN NOT NULL DEFAULT false;
