-- AlterTable
ALTER TABLE "chat_sessions" ALTER COLUMN "expires_at" SET DEFAULT (now() + interval '7 days');
