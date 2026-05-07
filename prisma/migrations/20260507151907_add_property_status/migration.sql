-- Rename the enum value to match the PRD contract (AVAILABLE | NEGOTIATING | RENTED).
-- `ALTER TYPE ... RENAME VALUE` rewrites the catalog label in place, so existing
-- rows carrying the old 'IN_NEGOTIATION' label transparently become 'NEGOTIATING'.
ALTER TYPE "PropertyStatus" RENAME VALUE 'IN_NEGOTIATION' TO 'NEGOTIATING';
