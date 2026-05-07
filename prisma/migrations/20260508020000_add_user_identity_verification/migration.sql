-- LL-017: User.isIdentityVerified + User.identityVerifiedAt feed the "selo verificado"
-- (✓ dourado) on the tenant card. Fields are read-only from the API surface in this
-- epic — admin setter endpoint is a follow-up (PRD §8 Q3). Writable only via Prisma
-- Studio / seed for now.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_identity_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "identity_verified_at" TIMESTAMP(3);
